package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import java.net.InetAddress
import java.net.ServerSocket
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * [SyncEngineCycle] tests split out of [SyncEngineCycleTest] (T3, sync-core-test-assurance) to
 * keep both files at or under the project's 500-line limit: the empty-backlog "pull-only" attempt
 * (`runPullOnlyAttempt`), lease-fence edge cases (held elsewhere, reclaimed mid-flight during a
 * failure, an unexpected failure before/after the claim), the optimistic-base-token map's
 * present/absent/null distinctions, and `getLastChangelogId`'s bounds.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineCyclePullOnlyAndFenceTest {

  @Test
  fun anEmptyBacklogStillPullsAndAppliesTheResponse() {
    // The "pull-only" attempt (runPullOnlyAttempt): nothing to claim, but the JS cycle's own
    // no-op attempt always issues the reconcile request, so remote changes still arrive.
    SyncEngineTestDatabase().use { fixture ->
      insertBridgeConfigOnly(fixture, port = 0) // port patched below once the server is up
      val response = """{"bridge_changes":[{"record_id":"remote-x","change_type":"create","changed_fields":["name"],"timestamp":9,"snapshot":{"id":"remote-x","name":"Remote","status":1,"episodesWatched":0,"active":1,"firstCycle":0,"modified_at":0}}],"last_changelog_id":30}"""
      SyncEngineTestHttpServer(200, response).use { server ->
        fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(server.port.toString()))
        val states = mutableListOf<String>()

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-pull-only-success", states::add)

        assertEquals(CycleOutcome("closed", "closed", 0, 0, null), outcome)
        assertEquals("POST", server.request.method)
        val body = JSONObject(server.request.body)
        assertEquals(0, body.getJSONArray("pending_operations").length())
        // No "claimed" transition: nothing was claimed.
        assertEquals(listOf("checked", "sent", "applied", "closed"), states)
        assertEquals(30L, fixture.appDatabase.rawQuery(
          "SELECT last_changelog_id FROM bridge_config WHERE id = 1",
          null,
        ).use { cursor -> org.junit.Assert.assertTrue(cursor.moveToFirst()); cursor.getLong(0) })
        assertEquals(1, fixture.appDatabase.rawQuery(
          "SELECT COUNT(*) FROM pending_remote_changes",
          null,
        ).use { cursor -> org.junit.Assert.assertTrue(cursor.moveToFirst()); cursor.getInt(0) })
      }
    }
  }

  @Test
  fun anEmptyBacklogTransportFailureIsFailedWithNothingToRevert() {
    SyncEngineTestDatabase().use { fixture ->
      insertBridgeConfigOnly(fixture, port = 0)
      val closedPort = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
      fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(closedPort.toString()))
      val states = mutableListOf<String>()

      val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
        .run("foreground", "cycle-pull-only-transport-failure", states::add)

      assertEquals("failed", outcome.outcome)
      assertEquals(0, outcome.backlogReadCount)
      assertEquals("ConnectException", outcome.errorName)
      assertEquals(listOf("checked", "sent", "failed"), states)
    }
  }

  @Test
  fun anEmptyBacklogNonTwoXxResponseIsFailed() {
    SyncEngineTestDatabase().use { fixture ->
      insertBridgeConfigOnly(fixture, port = 0)
      SyncEngineTestHttpServer(500, "{\"error\":\"down\"}").use { server ->
        fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(server.port.toString()))

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-pull-only-5xx") {}

        assertEquals(CycleOutcome("failed", "failed", 0, 0, "ReconcileHttpError"), outcome)
      }
    }
  }

  @Test
  fun anEmptyBacklogUnparsableResponseIsFailed() {
    SyncEngineTestDatabase().use { fixture ->
      insertBridgeConfigOnly(fixture, port = 0)
      SyncEngineTestHttpServer(200, "not json").use { server ->
        fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(server.port.toString()))

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-pull-only-invalid-json") {}

        assertEquals(CycleOutcome("failed", "failed", 0, 0, "ReconcileParseException"), outcome)
      }
    }
  }

  @Test
  fun leaseHeldElsewhereIsNotApplicableAndNeverIssuesAnHttpRequest() {
    SyncEngineTestDatabase().use { fixture ->
      insertCycleInput(fixture, port = 0)
      // A live, unexpired holder under a DIFFERENT owner/fence than this attempt's cycle id.
      fixture.appDatabase.execSQL(
        "INSERT INTO sync_cycle_lock (id, owner, expires_at, fence) VALUES (1, 'native_engine', ?, 'someone-else')",
        arrayOf(System.currentTimeMillis() + ENGINE_LEASE_MS),
      )
      val states = mutableListOf<String>()

      val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
        .run("foreground", "cycle-lease-elsewhere", states::add)

      assertEquals(CycleOutcome("not_applicable", "not_applicable", 0, 0, null), outcome)
      assertEquals(listOf("checked", "not_applicable"), states)
      // The row still names the OTHER owner: this attempt never touched it.
      assertEquals("someone-else", leaseRow(fixture.appDatabase)?.fence)
      assertEquals(listOf(41L to "pending"), fixture.operationStatuses())
    }
  }

  @Test
  fun anUnexpectedFailureAfterTheClaimIsClassifiedFailedAndRevertsTheBatch() {
    // Forces a Throwable OTHER than LeaseLostException to escape runCycle after the claim: the
    // `animes` table (read by readAnimeBridgeTokens, AFTER claimRows) is dropped, so the
    // generic `catch (error: Throwable)` in run() -- not the LeaseLostException branch -- must
    // classify this as `failed` and revert the claimed batch to `pending`.
    SyncEngineTestDatabase().use { fixture ->
      insertCycleInput(fixture, port = 0)
      fixture.appDatabase.execSQL("DROP TABLE animes")
      val states = mutableListOf<String>()

      val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
        .run("foreground", "cycle-unexpected-failure", states::add)

      assertEquals("failed", outcome.outcome)
      assertEquals("SQLiteException", outcome.errorName)
      assertEquals(listOf(41L to "pending"), fixture.operationStatuses())
      assertEquals(listOf("checked", "claimed", "failed"), states)
      assertEquals(null, leaseRow(fixture.appDatabase))
    }
  }

  @Test
  fun aClaimedAnimeWithNoStoredTokenRowIsOmittedFromTheOptimisticBaseMap() {
    // readAnimeBridgeTokens: covers BOTH the present-token row (existing insertCycleInput
    // fixture, anime-k6) and an anime with no `animes` row at all in the SAME backlog, so the
    // `_id IN (...)` query's absent-entry case is exercised alongside the present one.
    SyncEngineTestDatabase().use { fixture ->
      insertCycleInput(fixture, port = 0)
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
          "VALUES (42, 'anime-no-token', 'create', '{}', 'pending', ?)",
        arrayOf(System.currentTimeMillis()),
      )
      SyncEngineTestHttpServer(200, "{}") { request ->
        val operations = JSONObject(request.body).getJSONArray("pending_operations")
        val byAnimeId = (0 until operations.length()).associate {
          val op = operations.getJSONObject(it)
          op.getString("anime_id") to op.has("base")
        }
        assertEquals(true, byAnimeId["anime-k6"])
        assertEquals(false, byAnimeId["anime-no-token"])
      }.use { server ->
        fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(server.port.toString()))

        SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-token-map") {}
      }
    }
  }

  @Test
  fun anInformationalResponseCodeBelowTwoHundredIsFailedAndRevertsToPending() {
    // `response.code !in 200..299`'s left comparison (`>= 200`) is true for every OTHER test in
    // this file (every code used elsewhere is >= 400); this is the only case below 200, and it
    // ALSO exercises `revertClaimedRows(deadLetter = response.code in 400..499)`'s `>= 400`
    // comparison going false (102 is neither a dead-letter 4xx nor a successful 2xx).
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer(102, "").use { server ->
        insertCycleInput(fixture, server.port)

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-informational-code") {}

        assertEquals(CycleOutcome("failed", "failed", 0, 1, "ReconcileHttpError"), outcome)
        assertEquals("pending", fixture.operationStatuses().single().second)
      }
    }
  }

  @Test
  fun anInformationalResponseCodeOnTheEmptyBacklogPathIsFailed() {
    SyncEngineTestDatabase().use { fixture ->
      insertBridgeConfigOnly(fixture, port = 0)
      SyncEngineTestHttpServer(102, "").use { server ->
        fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(server.port.toString()))

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", "cycle-pull-only-informational-code") {}

        assertEquals(CycleOutcome("failed", "failed", 0, 0, "ReconcileHttpError"), outcome)
      }
    }
  }

  @Test
  fun anAnimeRowWithNoStoredTokenYetIsAPresentNullEntryNotAnAbsentOne() {
    // Distinct from `aClaimedAnimeWithNoStoredTokenRowIsOmittedFromTheOptimisticBaseMap`: THIS
    // anime's `animes` row EXISTS (so the cursor visits it), but `bridge_modified_at IS NULL`
    // -- readAnimeBridgeTokens' own doc comment calls this "a present null entry", distinct
    // from an absent one, and only a real NULL column value exercises `cursor.isNull(1)` true.
    SyncEngineTestDatabase().use { fixture ->
      insertCycleInput(fixture, port = 0)
      fixture.appDatabase.execSQL(
        "INSERT INTO animes (_id, bridge_modified_at) VALUES ('anime-null-token', NULL)",
      )
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
          "VALUES (43, 'anime-null-token', 'create', '{}', 'pending', ?)",
        arrayOf(System.currentTimeMillis()),
      )
      SyncEngineTestHttpServer(200, "{}") { request ->
        val operations = JSONObject(request.body).getJSONArray("pending_operations")
        val byAnimeId = (0 until operations.length()).associate {
          val op = operations.getJSONObject(it)
          op.getString("anime_id") to op.has("base")
        }
        assertEquals(true, byAnimeId["anime-k6"])
        assertEquals(false, byAnimeId["anime-null-token"])
      }.use { server ->
        fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(server.port.toString()))

        SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-null-token") {}
      }
    }
  }

  @Test
  fun aLeaseReclaimedDuringTheRequestMakesTheRevertFailSilentlyInsteadOfMaskingTheHttpOutcome() {
    // Reclaims the lease from a SECOND real claimant while the request is in flight (same
    // technique as reclaimedLeaseWhileRequestIsInFlightAbandonsWithoutApplyingResponse in
    // SyncEngineCycleTest), but on a FAILURE response this time: revertClaimedRows has no
    // explicit requireLeaseOwnership check of its own (unlike the "applied" success path), so
    // its guarded UPDATE affects 0 rows and throws LeaseLostException -- caught and logged by
    // revertClaimedRows' OWN catch(Throwable), never reaching run()'s LeaseLostException branch.
    // The bridge's original 500 outcome must still be what the caller sees, not "abandoned".
    SyncEngineTestDatabase().use { fixture ->
      val cycleId = "cycle-revert-lease-lost"
      SyncEngineTestHttpServer(500, "{\"error\":\"down\"}") {
        fixture.appDatabase.execSQL("UPDATE sync_cycle_lock SET expires_at = 0 WHERE id = 1")
        check(SyncCycleLease(fixture.appDatabase).claim("cycle-successor")) {
          "Expected a second real lease claimant to reclaim the expired lease"
        }
      }.use { server ->
        insertCycleInput(fixture, server.port)

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
          .run("foreground", cycleId) {}

        assertEquals(CycleOutcome("failed", "failed", 0, 1, "ReconcileHttpError"), outcome)
        // The revert never landed (fenced out by the reclaim): the row stays "processing",
        // owned by the successor now, not reverted to "pending" by the original attempt.
        assertEquals("processing", fixture.operationStatuses().single().second)
        assertEquals("cycle-successor", leaseRow(fixture.appDatabase)?.fence)
      }
    }
  }

  @Test
  fun anUnexpectedFailureBeforeAnythingWasClaimedRevertsNothing() {
    // Distinct from anUnexpectedFailureAfterTheClaimIsClassifiedFailedAndRevertsTheBatch: THIS
    // failure happens in readBacklog(), BEFORE claimedRows is ever set away from its default
    // empty list -- revertClaimedRows' own `if (rows.isEmpty()) return` guard must be what
    // makes it a no-op, not an accidental empty-batch update.
    SyncEngineTestDatabase().use { fixture ->
      insertCycleInput(fixture, port = 0)
      fixture.appDatabase.execSQL("DROP TABLE operation_log")
      val states = mutableListOf<String>()

      val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal)
        .run("foreground", "cycle-failure-before-claim", states::add)

      assertEquals("failed", outcome.outcome)
      assertEquals("SQLiteException", outcome.errorName)
      assertEquals(listOf("checked", "failed"), states)
    }
  }

  @Test
  fun aNullLastChangelogIdDefaultsToZeroInTheRequestBody() =
    assertLastChangelogIdDefaultsToZero(sqlLiteral = "NULL")

  @Test
  fun aNegativeLastChangelogIdDefaultsToZeroInTheRequestBody() =
    assertLastChangelogIdDefaultsToZero(sqlLiteral = "-1")

  @Test
  fun aLastChangelogIdBeyondTheReasonableBoundDefaultsToZeroInTheRequestBody() =
    assertLastChangelogIdDefaultsToZero(sqlLiteral = "2000000000000")

  private fun assertLastChangelogIdDefaultsToZero(sqlLiteral: String) {
    SyncEngineTestDatabase().use { fixture ->
      insertCycleInput(fixture, port = 0)
      fixture.appDatabase.execSQL("UPDATE bridge_config SET last_changelog_id = $sqlLiteral WHERE id = 1")
      SyncEngineTestHttpServer(200, "{}") { request ->
        assertEquals(0L, JSONObject(request.body).getLong("last_changelog_id"))
      }.use { server ->
        fixture.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf(server.port.toString()))

        SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-changelog-$sqlLiteral") {}
      }
    }
  }

  private fun insertBridgeConfigOnly(fixture: SyncEngineTestDatabase, port: Int) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config " +
        "(id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-k6", "127.0.0.1", port.toString(), "token-k6", 20L),
    )
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
}
