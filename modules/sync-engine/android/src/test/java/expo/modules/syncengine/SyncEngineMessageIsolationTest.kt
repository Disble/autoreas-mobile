package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Per-message failure in the `:sync` process (ADR 009 R-5), mirroring
 * `tests/behaviour/sync/per-message-failure.behaviour.test.ts`: a 4xx other than 401 for a round
 * of several messages is re-sent one message per request, so only the message that caused it is
 * dead-lettered; a 401 rejects the pairing and dead-letters the whole round.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineMessageIsolationTest {
  private data class RowState(val animeId: String, val status: String, val claimOwner: String?)

  @Test
  fun isolatesA4xxToTheMessageThatCausedItAndChainsTheOtherKeyInTheSameCycle() {
    SyncEngineTestDatabase().use { fixture ->
      val responses = listOf(rejecting(422), rejecting(422), confirming("anime-b"), confirming("anime-b"))
      SyncEngineTestHttpServer.scripted(responses).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b", "anime-b"))

        val outcome = cycle(fixture).run("foreground", "cycle-isolation") {}

        assertEquals("closed", outcome.outcome)
        assertEquals(2, outcome.syncedCount)
        assertEquals(
          listOf(listOf("anime-a", "anime-b"), listOf("anime-a"), listOf("anime-b"), listOf("anime-b")),
          sentAnimeIds(server),
        )
        // Only the round that first went out carries the telemetry envelope.
        assertEquals(
          listOf(true, false, false, false),
          reconcileRequests(server).map { JSONObject(it.body).has("client_telemetry") },
        )
        assertEquals(
          listOf(
            RowState("anime-a", "dead_letter", null),
            RowState("anime-b", "synced", null),
            RowState("anime-b", "synced", null),
          ),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun a401DeadLettersEveryRowOfTheRoundSendsNoMessageAloneAndFailsTheCycle() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(rejecting(401))).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b"))

        val outcome = cycle(fixture).run("foreground", "cycle-401") {}

        assertEquals("failed", outcome.outcome)
        assertEquals("ReconcileHttpError", outcome.errorName)
        assertEquals(1, reconcileRequests(server).size)
        assertEquals(
          listOf(RowState("anime-a", "dead_letter", null), RowState("anime-b", "dead_letter", null)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun releasesEveryUnsentMessageWhenAnIsolatedSendFailsOnTheNetwork() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(rejecting(422), rejecting(503))).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b", "anime-c"))

        val outcome = cycle(fixture).run("foreground", "cycle-isolation-503") {}

        assertEquals("failed", outcome.outcome)
        assertEquals("ReconcileHttpError", outcome.errorName)
        assertEquals(listOf(listOf("anime-a", "anime-b", "anime-c"), listOf("anime-a")), sentAnimeIds(server))
        assertEquals(listOf("pending", "pending", "pending"), rows(fixture).map { it.status })
        assertEquals(listOf(null, null, null), rows(fixture).map { it.claimOwner })
      }
    }
  }

  @Test
  fun releasesTheSuccessorAnIsolatedMessageAlreadyChainedWhenALaterIsolatedSendFails() {
    SyncEngineTestDatabase().use { fixture ->
      val responses = listOf(rejecting(422), confirming("anime-a"), rejecting(503))
      SyncEngineTestHttpServer.scripted(responses).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b", "anime-a"))

        val outcome = cycle(fixture).run("foreground", "cycle-isolation-successor") {}

        assertEquals("failed", outcome.outcome)
        assertEquals(1, outcome.syncedCount)
        assertEquals(
          listOf(
            RowState("anime-a", "synced", null),
            RowState("anime-b", "pending", null),
            RowState("anime-a", "pending", null),
          ),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun failsTheCycleWhenEveryIsolatedMessageIsRejectedEachOneDeadLettered() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(rejecting(400))).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b"))

        val outcome = cycle(fixture).run("foreground", "cycle-isolation-all") {}

        assertEquals("failed", outcome.outcome)
        assertEquals("ReconcileHttpError", outcome.errorName)
        assertEquals(3, reconcileRequests(server).size)
        assertEquals(listOf("dead_letter", "dead_letter"), rows(fixture).map { it.status })
      }
    }
  }

  @Test
  fun stillReturnsEveryRowOfTheRoundToPendingOnA5xxWithoutIsolatingAny() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(rejecting(500))).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b"))

        val outcome = cycle(fixture).run("foreground", "cycle-5xx") {}

        assertEquals("failed", outcome.outcome)
        assertEquals(1, reconcileRequests(server).size)
        assertEquals(
          listOf(RowState("anime-a", "pending", null), RowState("anime-b", "pending", null)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun sendsEachIsolatedMessageOnTheCursorThePreviousOneReachedAndStoresTheLast() {
    SyncEngineTestDatabase().use { fixture ->
      val responses = listOf(rejecting(422), confirmingAt("anime-a", 5), rejecting(422), confirmingAt("anime-c", 9))
      SyncEngineTestHttpServer.scripted(responses).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b", "anime-c"))

        val outcome = cycle(fixture).run("foreground", "cycle-isolation-cursor") {}

        assertEquals("closed", outcome.outcome)
        assertEquals(
          listOf(0L, 0L, 5L, 5L),
          reconcileRequests(server).map { JSONObject(it.body).getLong("last_changelog_id") },
        )
        assertEquals(9L, storedCursor(fixture))
        assertEquals(listOf("synced", "dead_letter", "synced"), rows(fixture).map { it.status })
      }
    }
  }

  @Test
  fun neverResendsARowTheOtherRuntimeTookOverBetweenTheRejectionAndItsIsolatedSend() {
    SyncEngineTestDatabase().use { fixture ->
      var first = true
      lateinit var takeOver: () -> Unit
      val responses = listOf(rejecting(422), confirmingAt("anime-a", 3))
      SyncEngineTestHttpServer.scripted(responses) { request ->
        if (request.path == RECONCILE_PATH && first) {
          first = false
          takeOver()
        }
      }.use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b"))
        takeOver = {
          fixture.appDatabase.execSQL(
            "UPDATE operation_log SET claim_owner = 'js', claimed_at = 999 WHERE anime_id = 'anime-b'",
          )
        }

        val outcome = cycle(fixture).run("foreground", "cycle-isolation-takeover") {}

        assertEquals("closed", outcome.outcome)
        assertEquals(listOf(listOf("anime-a", "anime-b"), listOf("anime-a")), sentAnimeIds(server))
        assertEquals(
          listOf(RowState("anime-a", "synced", null), RowState("anime-b", "processing", "js")),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun a401OnAnIsolatedSendDeadLettersThatMessageAndReleasesTheRest() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(rejecting(422), rejecting(401))).use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b"))

        val outcome = cycle(fixture).run("foreground", "cycle-isolation-401") {}

        assertEquals("failed", outcome.outcome)
        assertEquals(
          listOf(RowState("anime-a", "dead_letter", null), RowState("anime-b", "pending", null)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun releasesTheInFlightMessageAndEveryUnsentOneWhenALocalWriteFailsDuringAnIsolatedSend() {
    SyncEngineTestDatabase().use { fixture ->
      var count = 0
      lateinit var breakLocalWrites: () -> Unit
      val responses = listOf(rejecting(422), confirmingAt("anime-a", 3), confirmingAt("anime-b", 4))
      SyncEngineTestHttpServer.scripted(responses) { request ->
        if (request.path == RECONCILE_PATH) {
          count += 1
          if (count == 2) breakLocalWrites()
        }
      }.use { server ->
        seed(fixture, server, listOf("anime-a", "anime-b"))
        breakLocalWrites = { fixture.appDatabase.execSQL("ALTER TABLE animes RENAME TO animes_gone") }

        val outcome = cycle(fixture).run("foreground", "cycle-isolation-local-failure") {}

        assertEquals("failed", outcome.outcome)
        assertEquals(
          listOf(RowState("anime-a", "pending", null), RowState("anime-b", "pending", null)),
          rows(fixture),
        )
      }
    }
  }

  /** Pins the shared send path: only isolated re-sends drop the telemetry envelope, never a pull-only round. */
  @Test
  fun aPullOnlyAttemptStillPullsSinceTheStoredCursorWithTheTelemetryEnvelope() {
    SyncEngineTestDatabase().use { fixture ->
      val response = SyncEngineTestHttpServer.Response(200, """{"applied_operations":[],"last_changelog_id":4}""")
      SyncEngineTestHttpServer.scripted(listOf(response)).use { server ->
        seed(fixture, server, emptyList())
        fixture.appDatabase.execSQL("UPDATE bridge_config SET last_changelog_id = 2")

        val outcome = cycle(fixture).run("foreground", "cycle-pull-only-cursor") {}

        assertEquals("closed", outcome.outcome)
        val body = JSONObject(reconcileRequests(server).single().body)
        assertEquals(2L, body.getLong("last_changelog_id"))
        assertEquals(0, body.getJSONArray("pending_operations").length())
        assertEquals(true, body.has("client_telemetry"))
        assertEquals(4L, storedCursor(fixture))
      }
    }
  }

  private fun cycle(fixture: SyncEngineTestDatabase) = SyncEngineCycle(fixture.appDatabase, fixture.journal)

  /** A paired bridge, every anime stored at token 7, and one queued row per [animeIds] entry. */
  private fun seed(fixture: SyncEngineTestDatabase, server: SyncEngineTestHttpServer, animeIds: List<String>) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-isolation", "127.0.0.1", server.port.toString(), "token-isolation", 0L),
    )
    for (animeId in animeIds.distinct()) {
      fixture.appDatabase.execSQL("INSERT INTO animes (_id, bridge_modified_at) VALUES (?, 7)", arrayOf<Any>(animeId))
    }
    val createdAt = System.currentTimeMillis()
    animeIds.forEachIndexed { index, animeId ->
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
          "VALUES (?, ?, 'update', ?, 'pending', ?)",
        arrayOf<Any>(index + 1L, animeId, PAYLOAD, createdAt + index),
      )
    }
  }

  private fun confirming(animeId: String) = SyncEngineTestHttpServer.Response(
    200,
    """{"applied_operations":[{"anime_id":"$animeId","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":1}""",
  )

  private fun confirmingAt(animeId: String, cursor: Long) = SyncEngineTestHttpServer.Response(
    200,
    """{"applied_operations":[{"anime_id":"$animeId","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":$cursor}""",
  )

  private fun rejecting(code: Int) = SyncEngineTestHttpServer.Response(code, """{"error":"rejected"}""")

  private fun reconcileRequests(server: SyncEngineTestHttpServer) =
    server.requests.filter { it.path == RECONCILE_PATH }

  /** The anime ids each reconcile request carried, in send order. */
  private fun sentAnimeIds(server: SyncEngineTestHttpServer): List<List<String>> = reconcileRequests(server).map {
    val operations = JSONObject(it.body).getJSONArray("pending_operations")
    (0 until operations.length()).map { index -> operations.getJSONObject(index).getString("anime_id") }
  }

  private fun storedCursor(fixture: SyncEngineTestDatabase): Long =
    fixture.appDatabase.rawQuery("SELECT last_changelog_id FROM bridge_config WHERE id = 1", null).use { cursor ->
      cursor.moveToFirst()
      cursor.getLong(0)
    }

  private fun rows(fixture: SyncEngineTestDatabase): List<RowState> = fixture.appDatabase.rawQuery(
    "SELECT anime_id, status, claim_owner FROM operation_log ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) {
        add(RowState(cursor.getString(0), cursor.getString(1), if (cursor.isNull(2)) null else cursor.getString(2)))
      }
    }
  }

  private companion object {
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val PAYLOAD = """{"status":2}"""
  }
}
