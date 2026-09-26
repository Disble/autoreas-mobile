package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Core happy/failure-path tests for [SyncEngineCycle], plus [CycleOutcome.toMap]. Pull-only
 * (empty backlog), lease-fence edge cases, and `getLastChangelogId` bounds live in
 * [SyncEngineCyclePullOnlyAndFenceTest] (T3, sync-core-test-assurance) to keep both files at or
 * under the project's 500-line limit.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineCycleTest {
  @Test
  fun successfulCyclePersistsFencedConfirmation() {
    SyncEngineTestDatabase().use { fixture ->
      val response = """{"applied_operations":[{"anime_id":"anime-k6","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":25}"""
      SyncEngineTestHttpServer(200, response).use { server ->
        val operationCreatedAt = insertCycleInput(fixture, server.port)
        val states = mutableListOf<String>()
        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-k6-success", states::add)

        assertEquals(CycleOutcome("closed", "closed", 1, 1, null), outcome)
        assertEquals("POST", server.request.method)
        assertEquals("/api/sync/reconcile", server.request.path)
        assertEquals("Bearer token-k6", server.request.headers["authorization"])
        assertTrue(server.request.headers["content-type"].orEmpty().startsWith("application/json"))
        val body = JSONObject(server.request.body)
        assertEquals("device-k6", body.getString("device_id"))
        assertEquals(20L, body.getLong("last_changelog_id"))
        val operation = body.getJSONArray("pending_operations").getJSONObject(0)
        assertEquals("anime-k6", operation.getString("anime_id"))
        assertEquals("update", operation.getString("operation"))
        assertEquals(2, operation.getJSONObject("payload").getInt("status"))
        assertEquals(operationCreatedAt, operation.getLong("created_at"))
        assertEquals("cycle-k6-success", body.getJSONObject("client_telemetry").getString("cycle_id"))

        assertEquals(listOf("checked", "claimed", "sent", "applied", "closed"), states)
        assertEquals("synced", fixture.operationStatuses().single().second)
        assertEquals(25L, fixture.appDatabase.rawQuery(
          "SELECT last_changelog_id FROM bridge_config WHERE id = 1",
          null,
        ).use { cursor ->
          assertTrue(cursor.moveToFirst())
          cursor.getLong(0)
        })
        assertEquals(
          listOf("checked", "claimed", "sent", "applied", "closed"),
          journalStates(fixture.journalDirectory, "cycle-k6-success"),
        )
        assertEquals(0, fixture.appDatabase.rawQuery(
          "SELECT COUNT(*) FROM sync_cycle_lock WHERE id = 1",
          null,
        ).use { cursor ->
          assertTrue(cursor.moveToFirst())
          cursor.getInt(0)
        })
      }
    }
  }

  @Test
  fun fourHundredResponseDeadLettersClaimedOperation() = assertCycleFailure(
    cycleId = "cycle-k6-4xx",
    statusCode = 422,
    responseBody = "{\"error\":\"invalid operation\"}",
    expectedStatus = "dead_letter",
    expectedErrorName = "ReconcileHttpError",
  )

  @Test
  fun fiveHundredResponseReturnsClaimedOperationToPending() = assertCycleFailure(
    cycleId = "cycle-k6-5xx",
    statusCode = 503,
    responseBody = "{\"error\":\"temporarily unavailable\"}",
    expectedStatus = "pending",
    expectedErrorName = "ReconcileHttpError",
  )

  @Test
  fun invalidJsonResponseReturnsClaimedOperationToPending() = assertCycleFailure(
    cycleId = "cycle-k6-invalid-json",
    statusCode = 200,
    responseBody = "not json",
    expectedStatus = "pending",
    expectedErrorName = "ReconcileParseException",
  )

  @Test
  fun closedLocalPortReturnsClaimedOperationToPending() {
    SyncEngineTestDatabase().use { fixture ->
      val closedPort = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
      insertCycleInput(fixture, closedPort)
      val states = mutableListOf<String>()

      val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
        .run("foreground", "cycle-k6-transport-failure", states::add)

      assertEquals("failed", outcome.outcome)
      assertEquals("failed", outcome.stage)
      assertEquals(0, outcome.syncedCount)
      assertEquals(1, outcome.backlogReadCount)
      assertEquals("ConnectException", outcome.errorName)
      assertEquals(listOf(41L to "pending"), fixture.operationStatuses())
      assertEquals(listOf("checked", "claimed", "sent", "failed"), states)
      assertEquals(
        listOf("checked", "claimed", "sent", "failed"),
        journalStates(fixture.journalDirectory, "cycle-k6-transport-failure"),
      )
      assertEquals(null, leaseRow(fixture.appDatabase))
    }
  }

  /**
   * Reclaims the real SQLite lease while the cycle is blocked awaiting this request's response.
   * This proves the cycle boundary stops a stale attempt; it does not characterize every private
   * guarded SQL statement independently.
   */
  @Test
  fun reclaimedLeaseWhileRequestIsInFlightAbandonsWithoutApplyingResponse() {
    SyncEngineTestDatabase().use { fixture ->
      val cycleId = "cycle-k6-stale"
      val journalFile = File(fixture.journalDirectory, "sync-journal.db")
      assertFalse("Journal unexpectedly existed before any append: $journalFile", journalFile.exists())
      val preflightAppend = fixture.journal.append(
        "cycle-k6-preflight",
        null,
        "closed",
        "diagnostic setup transition",
        System.currentTimeMillis(),
      )
      assertTrue(
        "Preflight append failed for $journalFile; journal logs=" +
          org.robolectric.shadows.ShadowLog.getLogs().filter { it.tag == "SyncEngineJournal" },
        preflightAppend,
      )
      assertTrue("Successful preflight append did not create $journalFile", journalFile.exists())
      val successorFence = "cycle-k6-successor"
      val response = """{"applied_operations":[{"anime_id":"anime-k6","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":25}"""
      SyncEngineTestHttpServer(200, response) { request ->
        assertEquals("POST", request.method)
        assertEquals(cycleId, JSONObject(request.body).getJSONObject("client_telemetry").getString("cycle_id"))
        val originalLease = leaseRow(fixture.appDatabase)
        check(originalLease?.fence == cycleId) { "Expected the in-flight cycle to own its lease, got $originalLease" }
        fixture.appDatabase.execSQL("UPDATE sync_cycle_lock SET expires_at = 0 WHERE id = 1")
        check(SyncCycleLease(fixture.appDatabase).claim(successorFence)) {
          "Expected a second real lease claimant to reclaim the expired lease"
        }
      }.use { server ->
        insertCycleInput(fixture, server.port)
        val states = mutableListOf<String>()
        val journalExistsAtCallback = mutableListOf<Boolean>()

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", cycleId) { state ->
            journalExistsAtCallback.add(journalFile.exists())
            states.add(state)
          }

        assertEquals(CycleOutcome("abandoned", "abandoned", 0, 0, "LeaseLost"), outcome)
        assertTrue("Journal absent before cycle callback observations: $journalFile", journalExistsAtCallback.all { it })
        assertEquals("/api/sync/reconcile", server.request.path)
        assertEquals(listOf(41L to "processing"), fixture.operationStatuses())
        assertEquals(20L, fixture.appDatabase.rawQuery(
          "SELECT last_changelog_id FROM bridge_config WHERE id = 1",
          null,
        ).use { cursor ->
          assertTrue(cursor.moveToFirst())
          cursor.getLong(0)
        })
        assertEquals(ENGINE_LOCK_OWNER to successorFence, leaseRow(fixture.appDatabase)?.let { it.owner to it.fence })
        assertTrue((leaseRow(fixture.appDatabase)?.expiresAt ?: 0L) > System.currentTimeMillis())
        assertEquals(listOf("checked", "claimed", "sent", "applied", "abandoned"), states)
        assertTrue(File(fixture.journalDirectory, "sync-journal.db").exists())
        assertEquals(
          listOf("checked", "claimed", "sent", "applied", "abandoned"),
          journalStates(fixture.journalDirectory, cycleId),
        )
        assertTrue(journalReasons(fixture.journalDirectory, cycleId).last().orEmpty().contains("lease lost"))
      }
    }
  }

  @Test
  fun cycleOutcomeToMapCarriesEveryFieldTheBridgeReturnsToTheJsSeam() {
    // Dedicated (T3, sync-core-test-assurance): every other test here asserts equality on the
    // CycleOutcome data class itself, never on toMap() -- the JS-visible payload SyncEngineModule
    // actually hands the bridge.
    val outcome = CycleOutcome(
      outcome = "closed",
      stage = "closed",
      syncedCount = 3,
      backlogReadCount = 5,
      errorName = null,
      recoveredProcessingCount = 2,
      recoveredAbandonedCycleId = "cycle-recovered",
    )

    val map = outcome.toMap("cycle-k6")

    assertEquals(
      mapOf(
        "outcome" to "closed",
        "cycleId" to "cycle-k6",
        "syncedCount" to 3,
        "backlogReadCount" to 5,
        "stage" to "closed",
        "errorName" to null,
        "recoveredProcessingCount" to 2,
        "recoveredAbandonedCycleId" to "cycle-recovered",
      ),
      map,
    )
  }

  @Test
  fun cycleOutcomeToMapDefaultsRecoveryFieldsToZeroAndNull() {
    val outcome = CycleOutcome("failed", "sent", 0, 0, "ReconcileHttpError")

    val map = outcome.toMap("cycle-defaults")

    assertEquals(0, map["recoveredProcessingCount"])
    assertEquals(null, map["recoveredAbandonedCycleId"])
    assertEquals("ReconcileHttpError", map["errorName"])
  }

  private fun assertCycleFailure(
    cycleId: String,
    statusCode: Int,
    responseBody: String,
    expectedStatus: String,
    expectedErrorName: String,
  ) {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(statusCode, responseBody).use { server ->
        insertCycleInput(fixture, server.port)
        val states = mutableListOf<String>()
        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", cycleId, states::add)

        assertEquals(CycleOutcome("failed", "failed", 0, 1, expectedErrorName), outcome)
        assertEquals("POST", server.request.method)
        assertEquals("/api/sync/reconcile", server.request.path)
        assertEquals(expectedStatus, fixture.operationStatuses().single().second)
        assertEquals(listOf("checked", "claimed", "sent", "failed"), states)
        assertEquals(listOf("checked", "claimed", "sent", "failed"), journalStates(fixture.journalDirectory, cycleId))
      }
    }
  }

  private fun insertCycleInput(fixture: SyncEngineTestDatabase, port: Int): Long {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config " +
        "(id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-k6", "127.0.0.1", port.toString(), "token-k6", 20L),
    )
    fixture.appDatabase.execSQL(
      "INSERT INTO animes (_id, bridge_modified_at) VALUES (?, ?)",
      arrayOf<Any>("anime-k6", 7L),
    )
    val createdAt = System.currentTimeMillis()
    fixture.appDatabase.execSQL(
      "INSERT INTO operation_log " +
        "(id, anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      arrayOf<Any>(41L, "anime-k6", "update", "{\"status\":2}", "pending", createdAt),
    )
    return createdAt
  }

  private data class LeaseRow(val owner: String, val fence: String, val expiresAt: Long)

  private fun leaseRow(database: SQLiteDatabase): LeaseRow? = database.rawQuery(
    "SELECT owner, fence, expires_at FROM sync_cycle_lock WHERE id = 1",
    null,
  ).use { cursor ->
    if (cursor.moveToFirst()) LeaseRow(cursor.getString(0), cursor.getString(1), cursor.getLong(2)) else null
  }

  private fun journalStates(directory: File, cycleId: String): List<String> =
    readJournalColumn(directory, cycleId, "to_state")

  private fun journalReasons(directory: File, cycleId: String): List<String?> =
    SQLiteDatabase.openDatabase(
      File(directory, "sync-journal.db").path,
      null,
      SQLiteDatabase.OPEN_READONLY,
    ).use { database ->
      database.rawQuery(
        "SELECT reason FROM journal WHERE cycle_id = ? ORDER BY id",
        arrayOf(cycleId),
      ).use { cursor ->
        buildList {
          while (cursor.moveToNext()) add(if (cursor.isNull(0)) null else cursor.getString(0))
        }
      }
    }

  private fun readJournalColumn(directory: File, cycleId: String, column: String): List<String> =
    SQLiteDatabase.openDatabase(
      File(directory, "sync-journal.db").path,
      null,
      SQLiteDatabase.OPEN_READONLY,
    ).use { database ->
      database.rawQuery(
        "SELECT $column FROM journal WHERE cycle_id = ? ORDER BY id",
        arrayOf(cycleId),
      ).use { cursor ->
        buildList {
          while (cursor.moveToNext()) add(cursor.getString(0))
        }
      }
    }
}
