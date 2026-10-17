package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode
import java.io.IOException

/**
 * Fetch-first in the `:sync` process (ADR 009 R-3), mirroring
 * `tests/behaviour/sync/fetch-first.behaviour.test.ts`: a held row whose anime has no stored token
 * is never sent without a base; the claim holder fetches the anime once and acts on the outcome.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineFetchFirstTest {
  private data class RowState(val id: Long, val status: String, val claimOwner: String?, val unresolvedReason: String?)

  @Test
  fun aNotFoundAnimeMakesTheWholeKeyUnresolvedAndSendsNoneOfItsRows() {
    SyncEngineTestDatabase().use { fixture ->
      val notFound = SyncEngineTestHttpServer.Response(404, """{"error":"anime not found"}""")
      SyncEngineTestHttpServer.scripted(listOf(notFound, emptyResponse())).use { server ->
        seed(fixture, server)

        cycle(fixture).run("foreground", "cycle-fetch-first") {}

        assertEquals(0, sentOperationCount(server))
        assertEquals(
          listOf(RowState(1, "dead_letter", null, "bridge_404"), RowState(2, "dead_letter", null, "bridge_404")),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun anAnimeReturnedWithNoTokenMakesTheKeyUnresolved() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(anime(""), emptyResponse())).use { server ->
        seed(fixture, server)

        cycle(fixture).run("foreground", "cycle-fetch-first") {}

        assertEquals(0, sentOperationCount(server))
        assertEquals(listOf("token_missing", "token_missing"), rows(fixture).map { it.unresolvedReason })
      }
    }
  }

  @Test
  fun aBridgeThatCannotAnswerLeavesTheRowsPendingAndReleased() {
    SyncEngineTestDatabase().use { fixture ->
      val unavailable = SyncEngineTestHttpServer.Response(503, """{"error":"busy"}""")
      SyncEngineTestHttpServer.scripted(listOf(unavailable, emptyResponse())).use { server ->
        seed(fixture, server)

        cycle(fixture).run("foreground", "cycle-fetch-first") {}

        assertEquals(0, sentOperationCount(server))
        assertEquals(
          listOf(RowState(1, "pending", null, null), RowState(2, "pending", null, null)),
          rows(fixture),
        )
      }
    }
  }

  @Test
  fun aTransportFailureKeepsTheKeyPending() {
    val outcome = fetchMissingTokenOutcome("anime-1") { throw IOException("connection refused") }

    assertEquals(MissingTokenOutcome.Unreachable, outcome)
  }

  @Test
  fun anInformationalStatusKeepsTheKeyPending() {
    val outcome = fetchMissingTokenOutcome("anime-1") { SyncEngineHttpResponse(199, null) }

    assertEquals(MissingTokenOutcome.Unreachable, outcome)
  }

  @Test
  fun aZeroTokenIsARealToken() {
    val outcome = fetchMissingTokenOutcome("anime-1") {
      SyncEngineHttpResponse(200, """{"id":"anime-1","modified_at":0}""")
    }

    assertEquals(MissingTokenOutcome.Token(0), outcome)
  }

  @Test
  fun aBodyThatIsNotJsonCarriesNoToken() {
    val outcome = fetchMissingTokenOutcome("anime-1") { SyncEngineHttpResponse(200, "not json") }

    assertEquals(MissingTokenOutcome.Unresolved("token_missing"), outcome)
  }

  @Test
  fun aMillisecondTimestampTokenIsReadAsALong() {
    val outcome = fetchMissingTokenOutcome("anime-1") {
      SyncEngineHttpResponse(200, """{"id":"anime-1","modified_at":1788540735366}""")
    }

    assertEquals(MissingTokenOutcome.Token(1_788_540_735_366L), outcome)
  }

  @Test
  fun anEmptyBodyCarriesNoToken() {
    val outcome = fetchMissingTokenOutcome("anime-1") { SyncEngineHttpResponse(200, null) }

    assertEquals(MissingTokenOutcome.Unresolved("token_missing"), outcome)
  }

  private fun cycle(fixture: SyncEngineTestDatabase) = SyncEngineCycle(fixture.appDatabase, fixture.journal)

  /** A paired bridge, `anime-1` stored with NO token, and two queued rows for it. */
  private fun seed(fixture: SyncEngineTestDatabase, server: SyncEngineTestHttpServer) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-fetch", "127.0.0.1", server.port.toString(), "token-fetch", 0L),
    )
    fixture.appDatabase.execSQL("INSERT INTO animes (_id) VALUES ('anime-1')")
    val createdAt = System.currentTimeMillis()
    for (id in 1L..2L) {
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
          "VALUES (?, 'anime-1', 'update', ?, 'pending', ?)",
        arrayOf<Any>(id, PAYLOAD, createdAt + id),
      )
    }
  }

  /** The bridge's `MobileAnime` for `anime-1`; [tokenField] is `,"modified_at":N` or empty. */
  private fun anime(tokenField: String) = SyncEngineTestHttpServer.Response(
    200,
    """{"id":"anime-1","name":"Test","status":0,"episodesWatched":9$tokenField}""",
  )

  private fun emptyResponse() = SyncEngineTestHttpServer.Response(200, """{"status":"accepted","applied_operations":[],"last_changelog_id":1}""")

  private fun reconcileRequests(server: SyncEngineTestHttpServer) = server.requests.filter { it.path == RECONCILE_PATH }

  private fun sentOperationCount(server: SyncEngineTestHttpServer): Int =
    reconcileRequests(server).sumOf { JSONObject(it.body).getJSONArray("pending_operations").length() }

  private fun rows(fixture: SyncEngineTestDatabase): List<RowState> = fixture.appDatabase.rawQuery(
    "SELECT id, status, claim_owner, unresolved_reason FROM operation_log ORDER BY id",
    null,
  ).use { cursor ->
    buildList {
      while (cursor.moveToNext()) {
        add(
          RowState(
            cursor.getLong(0),
            cursor.getString(1),
            if (cursor.isNull(2)) null else cursor.getString(2),
            if (cursor.isNull(3)) null else cursor.getString(3),
          ),
        )
      }
    }
  }

  private companion object {
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val PAYLOAD = """{"status":2}"""
  }
}
