package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Fetch-first races in the `:sync` process (ADR 009 R-3, R-11, R-13): what the app or the JS runtime
 * does while the claim holder waits on `GET /api/animes/{id}` decides what the holder may write and
 * send once the bridge answers.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineFetchFirstRacesTest {
  @Test
  fun anUnpairDuringTheFetchNeverWritesTheOldPairingsTokenBack() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(anime(ANIME_ID), emptyResponse())) { request ->
        if (request.method == "GET") {
          fixture.appDatabase.execSQL("DELETE FROM bridge_config")
          fixture.appDatabase.execSQL("DELETE FROM operation_log")
          fixture.appDatabase.execSQL("UPDATE animes SET bridge_modified_at = NULL")
        }
      }.use { server ->
        seed(fixture, server, ANIME_ID)

        cycle(fixture).run("foreground", "cycle-unpair-race") {}

        assertNull(token(fixture, ANIME_ID))
      }
    }
  }

  @Test
  fun aKeyTheJsRuntimeTakesOverDuringTheFetchIsNeverSent() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(anime(ANIME_ID), emptyResponse())) { request ->
        if (request.method == "GET") {
          fixture.appDatabase.execSQL(
            "UPDATE operation_log SET claim_owner = 'js', claimed_at = claimed_at + 61000 WHERE status = 'processing'",
          )
        }
      }.use { server ->
        seed(fixture, server, ANIME_ID)

        cycle(fixture).run("foreground", "cycle-takeover-race") {}

        assertEquals(0, sentOperationCount(server))
      }
    }
  }

  @Test
  fun theFetchedAnimeIdIsEncodedAsOnePathSegment() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(anime("a b/c"), emptyResponse())).use { server ->
        seed(fixture, server, "a b/c")

        cycle(fixture).run("foreground", "cycle-encoding") {}

        assertEquals("GET", server.requests[0].method)
        assertEquals("/api/animes/a%20b%2Fc", server.requests[0].path)
      }
    }
  }

  private fun cycle(fixture: SyncEngineTestDatabase) = SyncEngineCycle(fixture.appDatabase, fixture.journal)

  /** A paired bridge, [animeId] stored with NO token, and two queued rows for it. */
  private fun seed(fixture: SyncEngineTestDatabase, server: SyncEngineTestHttpServer, animeId: String) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)",
      arrayOf<Any>("device-fetch", "127.0.0.1", server.port.toString(), "token-fetch", 0L),
    )
    fixture.appDatabase.execSQL("INSERT INTO animes (_id) VALUES (?)", arrayOf<Any>(animeId))
    val createdAt = System.currentTimeMillis()
    for (id in 1L..2L) {
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) " +
          "VALUES (?, ?, 'update', ?, 'pending', ?)",
        arrayOf<Any>(id, animeId, PAYLOAD, createdAt + id),
      )
    }
  }

  /** The bridge's `MobileAnime` for [animeId], carrying the token 42. */
  private fun anime(animeId: String) = SyncEngineTestHttpServer.Response(
    200,
    JSONObject().put("id", animeId).put("name", "Test").put("modified_at", 42).toString(),
  )

  private fun emptyResponse() = SyncEngineTestHttpServer.Response(200, """{"status":"accepted","applied_operations":[],"last_changelog_id":1}""")

  private fun sentOperationCount(server: SyncEngineTestHttpServer): Int = server.requests
    .filter { it.path == RECONCILE_PATH }
    .sumOf { JSONObject(it.body).getJSONArray("pending_operations").length() }

  private fun token(fixture: SyncEngineTestDatabase, animeId: String): Long? = fixture.appDatabase.rawQuery(
    "SELECT bridge_modified_at FROM animes WHERE _id = ?",
    arrayOf(animeId),
  ).use { cursor ->
    check(cursor.moveToFirst())
    if (cursor.isNull(0)) null else cursor.getLong(0)
  }

  private companion object {
    const val ANIME_ID = "anime-1"
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val PAYLOAD = """{"status":2}"""
  }
}
