package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * A local write failure around a season rating (T17 verifier B1/B2; ADR 009 R-5 I4, R-13, S8):
 * no row this attempt claimed stays `processing` once the attempt ends, and the outcome matches
 * the JS runtime (`season-rating-write-failure.behaviour.test.ts`).
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineSeasonRatingWriteFailureTest {
  private data class RowState(val id: Long, val status: String, val claimOwner: String?)

  @Test
  fun aRatingWhoseDeliveryCouldNotBeWrittenIsReleasedAndTheNextRatingIsStillSent() {
    val (outcome, paths, rows) = run(listOf(pullOnly(), delivered(), delivered())) { fixture ->
      seedRow(fixture, 1, RATING, "anime-1")
      seedRow(fixture, 2, RATING, "anime-2")
      failStatusWrite(fixture, "OLD.id = 1 AND NEW.status = 'synced'")
    }

    assertEquals("closed", outcome.outcome)
    assertEquals(listOf(RECONCILE_PATH, RATING_PATH, RATING_PATH), paths)
    assertEquals(listOf(RowState(1, "pending", null), RowState(2, "synced", null)), rows)
  }

  @Test
  fun aRatingWhoseReleaseCannotBeWrittenEitherIsLeftToItsClaimExpiryAndThePassGoesOn() {
    val (outcome, paths, rows) = run(listOf(pullOnly(), delivered(), delivered())) { fixture ->
      seedRow(fixture, 1, RATING, "anime-1")
      seedRow(fixture, 2, RATING, "anime-2")
      // Once row 1 is claimed every status write of it fails: the settle and the separate release.
      failStatusWrite(fixture, "OLD.id = 1 AND OLD.status = 'processing'")
    }

    assertEquals("closed", outcome.outcome)
    assertEquals(listOf(RECONCILE_PATH, RATING_PATH, RATING_PATH), paths)
    assertEquals(listOf(RowState(1, "processing", "native"), RowState(2, "synced", null)), rows)
  }

  @Test
  fun aReconcileThatFailsLocallyReleasesTheRoundsRatingsUnsent() {
    val (outcome, paths, rows) = run(listOf(confirmed(14), delivered())) { fixture ->
      seedRow(fixture, 1, UPDATE, "anime-1")
      seedRow(fixture, 2, RATING, "anime-2")
      failStatusWrite(fixture, "OLD.operation = 'update' AND NEW.status = 'synced'")
    }

    assertEquals("failed", outcome.outcome)
    assertEquals(listOf(RECONCILE_PATH), paths)
    assertEquals(listOf(RowState(1, "pending", null), RowState(2, "pending", null)), rows)
  }

  @Test
  fun aWriteFailureOnALaterRatingNeverStrandsTheSuccessorAnEarlierDeliveryClaimed() {
    val (_, _, rows) = run(listOf(pullOnly(), delivered(), delivered(), confirmed(14))) { fixture ->
      seedRow(fixture, 1, RATING, "anime-1")
      seedRow(fixture, 2, UPDATE, "anime-1")
      seedRow(fixture, 3, RATING, "anime-2")
      failStatusWrite(fixture, "OLD.id = 3 AND NEW.status = 'synced'")
    }

    assertEquals(emptyList<RowState>(), rows.filter { it.status == "processing" })
    assertEquals(RowState(1, "synced", null), rows[0])
  }

  private fun run(
    script: List<SyncEngineTestHttpServer.Response>,
    setup: (SyncEngineTestDatabase) -> Unit,
  ): Triple<CycleOutcome, List<String>, List<RowState>> = SyncEngineTestDatabase().use { fixture ->
    SyncEngineTestHttpServer.scripted(script).use { server ->
      fixture.appDatabase.execSQL(
        "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
        arrayOf<Any>("device-rating", "127.0.0.1", server.port.toString(), "token-rating", 0L),
      )
      for (animeId in listOf("anime-1", "anime-2")) {
        fixture.appDatabase.execSQL("INSERT INTO animes (_id, bridge_modified_at) VALUES (?, 7)", arrayOf<Any?>(animeId))
      }
      setup(fixture)

      val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-rating-write-failure") {}

      Triple(outcome, server.requests.map { it.path }, rows(fixture))
    }
  }

  private fun failStatusWrite(fixture: SyncEngineTestDatabase, condition: String) {
    fixture.appDatabase.execSQL(
      "CREATE TRIGGER fail_status_write BEFORE UPDATE OF status ON operation_log WHEN $condition " +
        "BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
    )
  }

  private fun seedRow(fixture: SyncEngineTestDatabase, id: Long, operation: String, animeId: String) {
    fixture.appDatabase.execSQL(
      "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      arrayOf<Any?>(id, animeId, operation, if (operation == UPDATE) UPDATE_PAYLOAD else RATING_PAYLOAD, System.currentTimeMillis() + id),
    )
  }

  private fun rows(fixture: SyncEngineTestDatabase): List<RowState> = fixture.appDatabase.rawQuery(
    "SELECT id, status, claim_owner FROM operation_log ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) {
        add(RowState(cursor.getLong(0), cursor.getString(1), if (cursor.isNull(2)) null else cursor.getString(2)))
      }
    }
  }

  private fun confirmed(token: Long) = SyncEngineTestHttpServer.Response(
    200,
    """{"status":"accepted","applied_operations":[{"anime_id":"anime-1","operation":"update","applied":true,"modified_at":$token}],"last_changelog_id":1}""",
  )

  private fun pullOnly() = SyncEngineTestHttpServer.Response(200, """{"status":"accepted","applied_operations":[],"last_changelog_id":1}""")

  private fun delivered() = SyncEngineTestHttpServer.Response(204, "")

  private companion object {
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val RATING_PATH = "/api/seasons/active/ratings"
    const val UPDATE = "update"
    const val RATING = "season_rating"
    const val UPDATE_PAYLOAD = """{"status":2}"""
    const val RATING_PAYLOAD = """{"seasonId":"season-1","grade":5,"ratedAt":1700000000000}"""
  }
}
