package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Chained sends per key in the `:sync` process (ADR 009 R-14), mirroring
 * `tests/behaviour/sync/outbox-chain.behaviour.test.ts`: the claim holder sends a key's oldest
 * row, waits for its confirmation and token, then sends the next row; the chain stops on a
 * rejection, a failed round, or 20 s, and the claim is released when it stops.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineChainTest {
  private data class RowState(val id: Long, val status: String, val claimOwner: String?, val attemptCount: Long)

  @Test
  fun sendsTheNextRowOnlyAfterThePreviousOneIsConfirmedOnTheTokenItReturned() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(confirmed(14), confirmed(15))).use { server ->
        seed(fixture, server)

        val outcome = cycle(fixture).run("foreground", "cycle-chain") {}

        assertEquals("closed", outcome.outcome)
        assertEquals(2, outcome.syncedCount)
        assertEquals(listOf(7L, 14L), sentBases(server))
        // One telemetry envelope per cycle, like JS: only the first round carries it.
        assertEquals(
          listOf(true, false),
          reconcileRequests(server).map { JSONObject(it.body).has("client_telemetry") },
        )
        assertEquals(listOf("synced", "synced"), rows(fixture).map { it.status })
        assertEquals(15L, token(fixture))
      }
    }
  }

  @Test
  fun aRejectionStopsTheKeyAndLeavesTheRowBehindItPendingAndUnclaimed() {
    SyncEngineTestDatabase().use { fixture ->
      val conflict = rejected(""""reason":"conflict","modified_at":9""")
      SyncEngineTestHttpServer.scripted(listOf(conflict)).use { server ->
        seed(fixture, server)

        cycle(fixture).run("foreground", "cycle-chain") {}

        assertEquals(1, reconcileRequests(server).size)
        assertEquals(
          // The conflict's token (9) advanced past the sent base (7): re-based, count reset.
          listOf(RowState(1, "pending", null, 0), RowState(2, "pending", null, 0)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun theRowsBehindAGivenUpRowAreHeldInThisCycleAndTheNext() {
    SyncEngineTestDatabase().use { fixture ->
      val responses = listOf(rejected(""""reason":"unsupported_operation""""), emptyResponse())
      SyncEngineTestHttpServer.scripted(responses).use { server ->
        seed(fixture, server)

        cycle(fixture).run("foreground", "cycle-chain-1") {}
        cycle(fixture).run("foreground", "cycle-chain-2") {}

        val requests = reconcileRequests(server)
        assertEquals(2, requests.size)
        assertEquals(0, JSONObject(requests[1].body).getJSONArray("pending_operations").length())
        assertEquals(
          listOf(RowState(1, "dead_letter", null, 0), RowState(2, "pending", null, 0)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun aNetworkFailureMidChainLeavesTheUnsentRowPendingUnclaimedAndUncounted() {
    SyncEngineTestDatabase().use { fixture ->
      val failure = SyncEngineTestHttpServer.Response(500, """{"error":"boom"}""")
      SyncEngineTestHttpServer.scripted(listOf(confirmed(14), failure)).use { server ->
        seed(fixture, server)

        val outcome = cycle(fixture).run("foreground", "cycle-chain") {}

        assertEquals("failed", outcome.outcome)
        assertEquals(1, outcome.syncedCount)
        assertEquals(
          listOf(RowState(1, "synced", null, 0), RowState(2, "pending", null, 0)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun chainingStopsAfterTwentySecondsAndReleasesTheRowItDidNotSend() {
    SyncEngineTestDatabase().use { fixture ->
      var now = System.currentTimeMillis()
      val server = SyncEngineTestHttpServer.scripted(listOf(confirmed(14), confirmed(15))) { request ->
        if (request.path == RECONCILE_PATH) now += 21_000
      }
      server.use {
        seed(fixture, server)

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal, clock = { now })
          .run("foreground", "cycle-chain") {}

        assertEquals("closed", outcome.outcome)
        assertEquals(1, reconcileRequests(server).size)
        assertEquals(
          listOf(RowState(1, "synced", null, 0), RowState(2, "pending", null, 0)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun neverWritesATokenFromAResponseForAKeyTheJsRuntimeTookOver() {
    SyncEngineTestDatabase().use { fixture ->
      lateinit var takeOver: () -> Unit
      val server = SyncEngineTestHttpServer.scripted(listOf(confirmed(14))) { request ->
        if (request.path == RECONCILE_PATH) takeOver()
      }
      server.use {
        seed(fixture, server)
        // The claim expired mid-request: JS confirmed the row and stored a newer token.
        takeOver = {
          fixture.appDatabase.execSQL(
            "UPDATE operation_log SET status = 'synced', claim_owner = NULL, claimed_at = NULL WHERE id = 1",
          )
          fixture.appDatabase.execSQL("UPDATE animes SET bridge_modified_at = 50 WHERE _id = 'anime-1'")
        }

        cycle(fixture).run("foreground", "cycle-chain") {}

        assertEquals(50L, token(fixture))
        assertEquals(1, reconcileRequests(server).size)
      }
    }
  }

  private fun cycle(fixture: SyncEngineTestDatabase) = SyncEngineCycle(fixture.appDatabase, fixture.journal)

  /** A paired bridge, `anime-1` stored at token 7, and two queued `anime-1` rows. */
  private fun seed(fixture: SyncEngineTestDatabase, server: SyncEngineTestHttpServer) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-chain", "127.0.0.1", server.port.toString(), "token-chain", 0L),
    )
    fixture.appDatabase.execSQL("INSERT INTO animes (_id, bridge_modified_at) VALUES ('anime-1', 7)")
    val createdAt = System.currentTimeMillis()
    for (id in 1L..2L) {
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
          "VALUES (?, 'anime-1', 'update', ?, 'pending', ?)",
        arrayOf<Any>(id, PAYLOAD, createdAt + id),
      )
    }
  }

  private fun confirmed(token: Long) = response(
    """{"anime_id":"anime-1","operation":"update","applied":true,"modified_at":$token}""",
  )

  private fun rejected(reasonFields: String) = response(
    """{"anime_id":"anime-1","operation":"update","applied":false,$reasonFields}""",
  )

  private fun emptyResponse() = SyncEngineTestHttpServer.Response(200, """{"applied_operations":[],"last_changelog_id":1}""")

  private fun response(appliedOperation: String) = SyncEngineTestHttpServer.Response(
    200,
    """{"applied_operations":[$appliedOperation],"last_changelog_id":1}""",
  )

  private fun reconcileRequests(server: SyncEngineTestHttpServer) =
    server.requests.filter { it.path == RECONCILE_PATH }

  /** The `base` each reconcile request sent for its single operation, in send order. */
  private fun sentBases(server: SyncEngineTestHttpServer): List<Long> = reconcileRequests(server).map {
    JSONObject(it.body).getJSONArray("pending_operations").getJSONObject(0).getLong("base")
  }

  private fun rows(fixture: SyncEngineTestDatabase): List<RowState> = fixture.appDatabase.rawQuery(
    "SELECT id, status, claim_owner, conflict_attempt_count FROM operation_log ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) {
        add(RowState(cursor.getLong(0), cursor.getString(1), if (cursor.isNull(2)) null else cursor.getString(2), cursor.getLong(3)))
      }
    }
  }

  private fun token(fixture: SyncEngineTestDatabase): Long = fixture.appDatabase.rawQuery(
    "SELECT bridge_modified_at FROM animes WHERE _id = 'anime-1'",
    null,
  ).use { cursor ->
    check(cursor.moveToFirst())
    cursor.getLong(0)
  }

  private companion object {
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val PAYLOAD = """{"status":2}"""
  }
}
