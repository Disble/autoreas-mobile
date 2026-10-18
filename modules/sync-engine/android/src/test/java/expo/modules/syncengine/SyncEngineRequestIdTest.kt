package expo.modules.syncengine

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * Request correlation in the `:sync` process: every bridge request one attempt makes carries
 * `X-Autoreas-Request-Id: <cycleId>:<n>`, with n strictly consecutive in send order -- the
 * presence probe, the diagnostics drain, the fetch-first GET, every reconcile (the
 * one-message-per-request re-sends included) and the season-rating POSTs.
 */
@RunWith(RobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineRequestIdTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    SyncEngineRunner.resetForTest()
  }

  @After
  fun tearDown() {
    SyncEngineRunner.resetForTest()
  }

  @Test
  fun `every request of one cycle carries the cycle id and the next sequence number`() {
    SyncEngineTestDatabase(appDatabaseIsFile = true).use { fixture ->
      val responses = listOf(
        SyncEngineTestHttpServer.Response(200, """{"status":"ok"}"""),
        SyncEngineTestHttpServer.Response(200, """{"id":"anime-1","modified_at":5}"""),
        SyncEngineTestHttpServer.Response(422, """{"error":"rejected"}"""),
        confirming("anime-1"),
        confirming("anime-2"),
        SyncEngineTestHttpServer.Response(204, ""),
      )
      SyncEngineTestHttpServer.scripted(responses).use { server ->
        seedCycle(fixture, server.port)
        val cycleId = "0f8b4c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f"

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal, requestIds = RequestIdSequence(cycleId))
          .run("foreground", cycleId) {}

        assertEquals("closed", outcome.outcome)
        assertEquals(
          listOf(DIAGNOSTICS_PATH, "/api/animes/anime-1", RECONCILE_PATH, RECONCILE_PATH, RECONCILE_PATH, RATING_PATH),
          server.requests.map { it.path },
        )
        assertEquals((1..6).map { "$cycleId:$it" }, server.requests.map { it.headers[REQUEST_ID_HEADER] })
      }
    }
  }

  @Test
  fun `a cycle built without a sequence sends no request id header`() {
    SyncEngineTestDatabase().use { fixture ->
      SyncEngineTestHttpServer.scripted(listOf(pullOnly())).use { server ->
        fixture.appDatabase.execSQL(
          "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, 'd', '127.0.0.1', ?, 't', 0)",
          arrayOf<Any>(server.port.toString()),
        )

        val outcome = SyncEngineCycle(fixture.appDatabase, fixture.journal).run("foreground", "cycle-plain") {}

        assertEquals("closed", outcome.outcome)
        assertEquals(listOf<String?>(null), server.requests.map { it.headers[REQUEST_ID_HEADER] })
      }
    }
  }

  @Test
  fun `the runner numbers the presence probe first and the reconcile after it`() {
    SyncEngineTestHttpServer.scripted(
      listOf(
        SyncEngineTestHttpServer.Response(200, """{"status":"ok"}"""),
        SyncEngineTestHttpServer.Response(200, """{"status":"accepted","applied_operations":[],"last_changelog_id":1}"""),
      ),
    ).use { server ->
      seedRunnerSchema(server.port)
      val cycleId = "7d2f9a10-4b6c-4e8d-9f01-23456789abcd"
      val results = mutableListOf<CycleOutcome>()
      val latch = CountDownLatch(1)

      SyncEngineRunner.runOnce(
        context = context,
        triggerSource = "test",
        cycleId = cycleId,
        startMs = System.currentTimeMillis(),
        requirePresence = true,
      ) { outcome ->
        results += outcome
        latch.countDown()
      }

      assertTrue(latch.await(10, TimeUnit.SECONDS))
      assertEquals("closed", results.single().outcome)
      assertEquals(listOf("/api/status", RECONCILE_PATH), server.requests.map { it.path })
      assertEquals(listOf("$cycleId:1", "$cycleId:2"), server.requests.map { it.headers[REQUEST_ID_HEADER] })
    }
  }

  /**
   * One stored diagnostics envelope, `anime-1` stored with no token (fetched first), `anime-2`
   * at token 7, and three queued rows: both animes' edits share the first reconcile, and
   * `anime-2`'s season rating is the successor its confirmation claims.
   */
  private fun seedCycle(fixture: SyncEngineTestDatabase, port: Int) {
    fixture.appDatabase.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id, is_sync_telemetry_enabled) " +
        "VALUES (1, 'device-1', '127.0.0.1', ?, 'token-1', 0, '1')",
      arrayOf<Any>(port.toString()),
    )
    fixture.appDatabase.execSQL("INSERT INTO animes (_id) VALUES ('anime-1')")
    fixture.appDatabase.execSQL("INSERT INTO animes (_id, bridge_modified_at) VALUES ('anime-2', 7)")
    val createdAt = System.currentTimeMillis()
    val rows = listOf(
      Triple("anime-1", "update", """{"status":2}"""),
      Triple("anime-2", "update", """{"status":2}"""),
      Triple("anime-2", "season_rating", """{"seasonId":"season-1","grade":5,"ratedAt":1700000000000}"""),
    )
    rows.forEachIndexed { index, (animeId, operation, payload) ->
      fixture.appDatabase.execSQL(
        "INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
        arrayOf<Any>(index + 1L, animeId, operation, payload, createdAt + index),
      )
    }
    fixture.seedTelemetryEntry("cycle-diag-1", """{"cycle_id":"cycle-diag-1"}""", createdAt)
  }

  /** The runner's own database file, at the readiness stamp, paired with [port], backlog empty. */
  private fun seedRunnerSchema(port: Int) {
    val db = openAppDatabase(context)
    try {
      db.execSQL(
        "CREATE TABLE sync_cycle_lock (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, " +
          "expires_at INTEGER NOT NULL, fence TEXT NOT NULL)",
      )
      db.execSQL(
        "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
          "token TEXT, last_changelog_id INTEGER, is_sync_telemetry_enabled INTEGER)",
      )
      db.execSQL("CREATE TABLE animes (_id TEXT PRIMARY KEY, bridge_modified_at INTEGER)")
      db.execSQL(
        "CREATE TABLE operation_log (id INTEGER PRIMARY KEY, anime_id TEXT, operation TEXT, " +
          "payload TEXT, status TEXT NOT NULL, created_at INTEGER, " +
          "conflict_attempt_count INTEGER NOT NULL DEFAULT 0, claim_owner TEXT, claimed_at INTEGER, unresolved_reason TEXT)",
      )
      db.execSQL(
        "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, 'device-1', '127.0.0.1', ?, 'token-1', 0)",
        arrayOf<Any>(port.toString()),
      )
      db.execSQL("PRAGMA user_version = $EXPECTED_SCHEMA_READINESS_VERSION")
    } finally {
      db.close()
    }
  }

  private fun confirming(animeId: String) = SyncEngineTestHttpServer.Response(
    200,
    """{"status":"accepted","applied_operations":[{"anime_id":"$animeId","operation":"update","applied":true,"modified_at":14}],"last_changelog_id":1}""",
  )

  private fun pullOnly() = SyncEngineTestHttpServer.Response(200, """{"status":"accepted","applied_operations":[],"last_changelog_id":1}""")

  private companion object {
    /** [SyncEngineTestHttpServer] lower-cases every captured header name. */
    const val REQUEST_ID_HEADER = "x-autoreas-request-id"
    const val DIAGNOSTICS_PATH = "/api/sync/diagnostics"
    const val RECONCILE_PATH = "/api/sync/reconcile"
    const val RATING_PATH = "/api/seasons/active/ratings"
  }
}
