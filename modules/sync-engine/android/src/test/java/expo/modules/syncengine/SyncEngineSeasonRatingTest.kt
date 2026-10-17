package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Season ratings sent from `operation_log` by the `:sync` process (ADR 009 R-2 I1, R-5, R-14,
 * R-16b; L20, L28): a `season_rating` row of an anime leaves through its own bridge endpoint, in
 * order with the anime's `update` rows, and a rating's answer never fails the attempt.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineSeasonRatingTest {
  private data class RowState(val id: Long, val operation: String, val status: String, val claimOwner: String?, val reason: String?)

  @Test
  fun aDeliveredRatingIsPostedToTheRatingEndpointAndBecomesSynced() {
    val (outcome, server, rows) = runRatingFate(SyncEngineTestHttpServer.Response(204, ""))

    assertEquals("closed", outcome.outcome)
    assertEquals(1, outcome.syncedCount)
    assertEquals(listOf(RECONCILE_PATH, RATING_PATH), server.map { it.path })
    assertEquals(
      JSONObject("""{"anime_id":"anime-1","grade":5,"rated_at":1700000000000}""").toString(),
      JSONObject(server[1].body).toString(),
    )
    assertEquals(listOf(RowState(1, RATING, "synced", null, null)), rows)
  }

  @Test
  fun everyRatingRejectionBecomesUnresolvedWithItsReasonAndNeverFailsTheAttempt() {
    val expected = mapOf(401 to "auth_repair", 404 to "not_found", 409 to "conflict", 422 to "rejected", 403 to "rejected")

    for ((code, reason) in expected) {
      val (outcome, server, rows) = runRatingFate(SyncEngineTestHttpServer.Response(code, """{"error":"no"}"""))

      assertEquals("$code", "closed", outcome.outcome)
      assertEquals("$code", 2, server.size)
      assertEquals("$code", listOf(RowState(1, RATING, "dead_letter", null, reason)), rows)
    }
  }

  @Test
  fun aServerErrorOnARatingLeavesItPendingAndUnclaimedWithoutFailingTheAttempt() {
    val (outcome, _, rows) = runRatingFate(SyncEngineTestHttpServer.Response(503, """{"error":"busy"}"""))

    assertEquals("closed", outcome.outcome)
    assertEquals(0, outcome.syncedCount)
    assertEquals(listOf(RowState(1, RATING, "pending", null, null)), rows)
  }

  @Test
  fun theRowsOfOneAnimeGoOutInOrderAcrossBothEndpoints() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(confirmed(14), delivered(), confirmed(15))).use { server ->
        seedBridge(fixture, server, token = 7)
        seedRow(fixture, 1, UPDATE, UPDATE_PAYLOAD)
        seedRow(fixture, 2, RATING, RATING_PAYLOAD)
        seedRow(fixture, 3, UPDATE, UPDATE_PAYLOAD)

        val outcome = cycle(fixture).run("foreground", "cycle-rating-order") {}

        assertEquals("closed", outcome.outcome)
        assertEquals(3, outcome.syncedCount)
        assertEquals(listOf(RECONCILE_PATH, RATING_PATH, RECONCILE_PATH), server.requests.map { it.path })
        // Each reconcile carries only the anime's `update` row, on the token the previous one returned.
        assertEquals(listOf(7L, 14L), sentBases(server))
        assertEquals(listOf("synced", "synced", "synced"), rows(fixture).map { it.status })
      }
    }
  }

  @Test
  fun aRejectedRatingStopsItsKeySoTheNextUpdateWaitsForTheNextCycle() {
    SyncEngineTestDatabase().use { fixture ->
      val script = listOf(confirmed(14), SyncEngineTestHttpServer.Response(409, """{"grade":3,"source":"manual"}"""), confirmed(15))
      SyncEngineTestHttpServer.scripted(script).use { server ->
        seedBridge(fixture, server, token = 7)
        seedRow(fixture, 1, UPDATE, UPDATE_PAYLOAD)
        seedRow(fixture, 2, RATING, RATING_PAYLOAD)
        seedRow(fixture, 3, UPDATE, UPDATE_PAYLOAD)

        cycle(fixture).run("foreground", "cycle-rating-stop-1") {}

        assertEquals(listOf(RECONCILE_PATH, RATING_PATH), server.requests.map { it.path })
        assertEquals(
          listOf(
            RowState(1, UPDATE, "synced", null, null),
            RowState(2, RATING, "dead_letter", null, "conflict"),
            RowState(3, UPDATE, "pending", null, null),
          ),
          rows(fixture),
        )

        cycle(fixture).run("foreground", "cycle-rating-stop-2") {}

        assertEquals(listOf(RECONCILE_PATH, RATING_PATH, RECONCILE_PATH), server.requests.map { it.path })
        assertEquals("synced", rows(fixture).last().status)
      }
    }
  }

  @Test
  fun aFailedReconcileReleasesTheRoundsRatingsUnsent() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(SyncEngineTestHttpServer.Response(500, """{"error":"boom"}"""))).use { server ->
        seedBridge(fixture, server, token = 7)
        seedRow(fixture, 1, UPDATE, UPDATE_PAYLOAD)
        seedRow(fixture, 2, RATING, RATING_PAYLOAD, animeId = "anime-2")

        val outcome = cycle(fixture).run("foreground", "cycle-rating-reconcile-fails") {}

        assertEquals("failed", outcome.outcome)
        assertEquals(listOf(RECONCILE_PATH), server.requests.map { it.path })
        assertEquals(
          listOf(RowState(1, UPDATE, "pending", null, null), RowState(2, RATING, "pending", null, null)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun aRatingWhoseClaimWasTakenOverBeforeItsSendIsNeverPosted() {
    SyncEngineTestDatabase().use { fixture ->
      lateinit var takeOver: () -> Unit
      val server = SyncEngineTestHttpServer.scripted(listOf(pullOnly(), delivered())) { request ->
        if (request.path == RECONCILE_PATH) takeOver()
      }
      server.use {
        seedBridge(fixture, server, token = 7)
        seedRow(fixture, 1, RATING, RATING_PAYLOAD)
        // The claim expired while the reconcile was out and the JS runtime took the key over.
        takeOver = {
          fixture.appDatabase.execSQL(
            "UPDATE operation_log SET claim_owner = 'js', claimed_at = ? WHERE id = 1",
            arrayOf<Any>(System.currentTimeMillis()),
          )
        }

        cycle(fixture).run("foreground", "cycle-rating-takeover") {}

        assertEquals(listOf(RECONCILE_PATH), server.requests.map { it.path })
        assertEquals(listOf(RowState(1, RATING, "processing", "js", null)), rows(fixture))
      }
    }
  }

  @Test
  fun aConfirmedUpdateNeverResolvesAGivenUpRating() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(confirmed(14))).use { server ->
        seedBridge(fixture, server, token = 7)
        seedRow(fixture, 1, RATING, RATING_PAYLOAD, status = "dead_letter", reason = "not_found")
        seedRow(fixture, 2, UPDATE, UPDATE_PAYLOAD)

        cycle(fixture).run("foreground", "cycle-rating-kind-1") {}

        assertEquals(
          listOf(RowState(1, RATING, "dead_letter", null, "not_found"), RowState(2, UPDATE, "synced", null, null)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun aDeliveredRatingResolvesOnlyTheGivenUpRatingsOfItsSeason() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(pullOnly(), delivered())).use { server ->
        seedBridge(fixture, server, token = 7)
        seedRow(fixture, 1, UPDATE, UPDATE_PAYLOAD, status = "dead_letter")
        seedRow(fixture, 2, RATING, RATING_PAYLOAD, status = "dead_letter", reason = "conflict")
        seedRow(fixture, 3, RATING, OTHER_SEASON_PAYLOAD, status = "dead_letter", reason = "rejected")
        seedRow(fixture, 4, RATING, RATING_PAYLOAD)

        cycle(fixture).run("foreground", "cycle-rating-kind-2") {}

        assertEquals(
          listOf(
            RowState(1, UPDATE, "dead_letter", null, null),
            RowState(3, RATING, "dead_letter", null, "rejected"),
            RowState(4, RATING, "synced", null, null),
          ),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun fetchFirstGivingAnAnimeUpNeverGivesUpItsPendingRating() {
    SyncEngineTestDatabase().use { fixture ->
      val notFound = SyncEngineTestHttpServer.Response(404, """{"error":"not found"}""")
      SyncEngineTestHttpServer.scripted(listOf(notFound, pullOnly())).use { server ->
        seedBridge(fixture, server, token = null)
        seedRow(fixture, 1, UPDATE, UPDATE_PAYLOAD)
        seedRow(fixture, 2, RATING, RATING_PAYLOAD)

        cycle(fixture).run("foreground", "cycle-rating-fetch-first") {}

        assertEquals(
          listOf(RowState(1, UPDATE, "dead_letter", null, "bridge_404"), RowState(2, RATING, "pending", null, null)),
          rows(fixture),
        )
      }
    }
  }

  /** One lone queued rating, a pull-only reconcile, then [answer] for the rating. */
  private fun runRatingFate(answer: SyncEngineTestHttpServer.Response): Triple<CycleOutcome, List<SyncEngineTestHttpServer.Request>, List<RowState>> =
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(pullOnly(), answer)).use { server ->
        seedBridge(fixture, server, token = 7)
        seedRow(fixture, 1, RATING, RATING_PAYLOAD)

        val outcome = cycle(fixture).run("foreground", "cycle-rating-fate") {}

        Triple(outcome, server.requests, rows(fixture))
      }
    }

  private fun cycle(fixture: SyncEngineTestDatabase) = SyncEngineCycle(fixture.appDatabase, fixture.journal)

  private fun seedBridge(fixture: SyncEngineTestDatabase, server: SyncEngineTestHttpServer, token: Long?) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-rating", "127.0.0.1", server.port.toString(), "token-rating", 0L),
    )
    fixture.appDatabase.execSQL("INSERT INTO animes (_id, bridge_modified_at) VALUES ('anime-1', ?)", arrayOf<Any?>(token))
  }

  private fun seedRow(
    fixture: SyncEngineTestDatabase,
    id: Long,
    operation: String,
    payload: String,
    animeId: String = "anime-1",
    status: String = "pending",
    reason: String? = null,
  ) {
    fixture.appDatabase.execSQL(
      "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at, unresolved_reason) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      arrayOf<Any?>(id, animeId, operation, payload, status, System.currentTimeMillis() + id, reason),
    )
  }

  private fun confirmed(token: Long) = SyncEngineTestHttpServer.Response(
    200,
    """{"status":"accepted","applied_operations":[{"anime_id":"anime-1","operation":"update","applied":true,"modified_at":$token}],"last_changelog_id":1}""",
  )

  private fun pullOnly() = SyncEngineTestHttpServer.Response(200, """{"status":"accepted","applied_operations":[],"last_changelog_id":1}""")

  private fun delivered() = SyncEngineTestHttpServer.Response(204, "")

  private fun sentBases(server: SyncEngineTestHttpServer): List<Long> =
    server.requests.filter { it.path == RECONCILE_PATH }.map {
      JSONObject(it.body).getJSONArray("pending_operations").getJSONObject(0).getLong("base")
    }

  private fun rows(fixture: SyncEngineTestDatabase): List<RowState> = fixture.appDatabase.rawQuery(
    "SELECT id, operation, status, claim_owner, unresolved_reason FROM operation_log ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) {
        add(
          RowState(
            cursor.getLong(0),
            cursor.getString(1),
            cursor.getString(2),
            if (cursor.isNull(3)) null else cursor.getString(3),
            if (cursor.isNull(4)) null else cursor.getString(4),
          ),
        )
      }
    }
  }

  private companion object {
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val RATING_PATH = "/api/seasons/active/ratings"
    const val UPDATE = "update"
    const val RATING = "season_rating"
    const val UPDATE_PAYLOAD = """{"status":2}"""
    const val RATING_PAYLOAD = """{"seasonId":"season-1","grade":5,"ratedAt":1700000000000}"""
    const val OTHER_SEASON_PAYLOAD = """{"seasonId":"season-0","grade":2,"ratedAt":1690000000000}"""
  }
}
