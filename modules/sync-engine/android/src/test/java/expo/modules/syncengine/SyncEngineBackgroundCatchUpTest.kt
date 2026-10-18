package expo.modules.syncengine

import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.IOException
import java.net.ServerSocket
import java.util.UUID

/**
 * Robolectric tests for the background catch-up (ODD background-covers-season T3/T4): the
 * active-season refresh into `active_season_cache` and the cover prefetch into `covers-inbox/`.
 * The bridge is a function seam, so each test scripts exactly what the bridge answers and reads
 * back what landed in the database and on disk.
 */
@RunWith(RobolectricTestRunner::class)
class SyncEngineBackgroundCatchUpTest {

  private lateinit var db: SQLiteDatabase
  private lateinit var filesDir: File

  private val config = BridgeConfigRow(
    id = 1,
    deviceId = "device-1",
    ip = "10.0.0.2",
    port = "3000",
    token = "tok",
    lastChangelogId = 0,
  )

  @Before
  fun setUp() {
    db = SQLiteDatabase.create(null)
    db.execSQL(
      "CREATE TABLE active_season_cache (id INTEGER PRIMARY KEY CHECK (id = 1), " +
        "season_id TEXT NOT NULL, candidates_json TEXT NOT NULL)",
    )
    db.execSQL("CREATE TABLE animes (_id TEXT PRIMARY KEY, activo INTEGER NOT NULL, portada TEXT)")
    db.execSQL(
      "CREATE TABLE pending_remote_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, " +
        "change_type TEXT NOT NULL, changed_fields TEXT NOT NULL, snapshot TEXT, timestamp INTEGER NOT NULL, " +
        "created_at INTEGER NOT NULL)",
    )
    filesDir = File(System.getProperty("java.io.tmpdir"), "catch-up-${UUID.randomUUID()}").apply { mkdirs() }
  }

  @After
  fun tearDown() {
    db.close()
    filesDir.deleteRecursively()
  }

  // ---- active season ----

  private fun refresh(response: () -> SyncEngineHttpResponse, onUrl: (String) -> Unit = {}): SeasonRefreshOutcome =
    SyncEngineSeasonRefresh(db) { url, token ->
      onUrl("$url|$token")
      response()
    }.refresh(config)

  private fun seedSeasonCache(seasonId: String = "old-season", candidates: String = "[]") {
    db.execSQL(
      "INSERT INTO active_season_cache (id, season_id, candidates_json) VALUES (1, ?, ?)",
      arrayOf(seasonId, candidates),
    )
  }

  private fun cachedSeason(): Pair<String, String>? =
    db.rawQuery("SELECT season_id, candidates_json FROM active_season_cache WHERE id = 1", null).use {
      if (it.moveToFirst()) it.getString(0) to it.getString(1) else null
    }

  @Test
  fun `a valid season replaces the cache with the candidates the JS reader expects`() {
    seedSeasonCache()
    var requested: String? = null
    val body = """{"season_id":"s-1","candidates":[{"anime_id":"a1","grade":null},""" +
      """{"anime_id":"a2","grade":6,"grade_source":"bridge"},{"anime_id":"a3"}]}"""

    val outcome = refresh({ SyncEngineHttpResponse(200, body) }) { requested = it }

    assertEquals(SeasonRefreshOutcome.CACHED, outcome)
    assertEquals("http://10.0.0.2:3000/api/seasons/active|tok", requested)
    val (seasonId, candidatesJson) = cachedSeason()!!
    assertEquals("s-1", seasonId)
    val candidates = JSONArray(candidatesJson)
    assertEquals(3, candidates.length())
    assertCandidate(candidates.getJSONObject(0), "a1", null, null)
    assertCandidate(candidates.getJSONObject(1), "a2", 6, "bridge")
    assertCandidate(candidates.getJSONObject(2), "a3", null, null)
  }

  private fun assertCandidate(candidate: JSONObject, animeId: String, grade: Int?, source: String?) {
    assertEquals(animeId, candidate.getString("anime_id"))
    if (grade == null) assertTrue(candidate.isNull("grade")) else assertEquals(grade, candidate.getInt("grade"))
    if (source == null) assertTrue(candidate.isNull("grade_source")) else assertEquals(source, candidate.getString("grade_source"))
  }

  @Test
  fun `a valid season is cached when no season was cached before`() {
    val outcome = refresh({ SyncEngineHttpResponse(200, """{"season_id":"s-2","candidates":[]}""") })

    assertEquals(SeasonRefreshOutcome.CACHED, outcome)
    assertEquals("s-2" to "[]", cachedSeason())
  }

  @Test
  fun `a 404 means no active season and clears the cache`() {
    seedSeasonCache()

    assertEquals(SeasonRefreshOutcome.CLEARED, refresh({ SyncEngineHttpResponse(404, null) }))
    assertNull(cachedSeason())
  }

  @Test
  fun `any other status keeps the cache`() {
    seedSeasonCache()

    assertEquals(SeasonRefreshOutcome.KEPT, refresh({ SyncEngineHttpResponse(500, "boom") }))
    assertEquals("old-season" to "[]", cachedSeason())
  }

  @Test
  fun `a transport failure keeps the cache`() {
    seedSeasonCache()

    assertEquals(SeasonRefreshOutcome.KEPT, refresh({ throw IOException("unreachable") }))
    assertEquals("old-season" to "[]", cachedSeason())
  }

  @Test
  fun `a body the JS reader would refuse keeps the cache`() {
    val invalidBodies = listOf(
      null,
      "not json",
      """{"candidates":[]}""",
      """{"season_id":"","candidates":[]}""",
      """{"season_id":"s","candidates":{}}""",
      """{"season_id":"s","candidates":[1]}""",
      """{"season_id":"s","candidates":[{"grade":1}]}""",
      """{"season_id":"s","candidates":[{"anime_id":""}]}""",
      """{"season_id":"s","candidates":[{"anime_id":"a","grade":"6"}]}""",
      """{"season_id":"s","candidates":[{"anime_id":"a","grade_source":"manual"}]}""",
    )
    seedSeasonCache()

    for (body in invalidBodies) {
      assertEquals("body $body", SeasonRefreshOutcome.KEPT, refresh({ SyncEngineHttpResponse(200, body) }))
      assertEquals("old-season" to "[]", cachedSeason())
    }
  }

  @Test
  fun `a store without the cache table keeps going without a throw`() {
    db.execSQL("DROP TABLE active_season_cache")

    assertEquals(SeasonRefreshOutcome.KEPT, refresh({ SyncEngineHttpResponse(404, null) }))
  }

  // ---- cover prefetch ----

  private val inbox: File get() = File(filesDir, COVER_INBOX_DIRECTORY_NAME)

  private fun addAnime(id: String, portada: String?, activo: Int = 1) {
    db.execSQL("INSERT INTO animes (_id, activo, portada) VALUES (?, ?, ?)", arrayOf<Any?>(id, activo, portada))
  }

  private fun stage(recordId: String, changeType: String, snapshot: String?) {
    db.execSQL(
      "INSERT INTO pending_remote_changes (record_id, change_type, changed_fields, snapshot, timestamp, created_at) " +
        "VALUES (?, ?, '[]', ?, 1, 1)",
      arrayOf<Any?>(recordId, changeType, snapshot),
    )
  }

  private fun writeManifest(vararg animeIds: String) {
    val entries = JSONObject()
    for (id in animeIds) entries.put(id, JSONObject().put("status", "image"))
    File(filesDir, COVERS_DIRECTORY_NAME).apply { mkdirs() }
      .resolve(COVER_MANIFEST_FILE_NAME)
      .writeText(JSONObject().put("version", 1).put("entries", entries).toString())
  }

  private class ScriptedDownloads(
    private val answer: (String) -> SyncEngineBinaryResponse,
  ) : (String, String) -> SyncEngineBinaryResponse {
    val urls = mutableListOf<String>()

    override fun invoke(url: String, token: String): SyncEngineBinaryResponse {
      urls += url
      return answer(url)
    }
  }

  private val jpeg = byteArrayOf(1, 2, 3)

  private fun image(etag: String? = "\"e1\"") = SyncEngineBinaryResponse(200, jpeg, etag)

  private fun prefetcher(downloads: ScriptedDownloads, now: () -> Long = { 1_000L }) =
    SyncEngineCoverPrefetch(db, filesDir, downloads, now)

  @Test
  fun `downloads only active animes with a cover and no manifest entry, as complete inbox pairs`() {
    writeManifest("known")
    addAnime("known", "/c/known.jpg")
    addAnime("new", " /c/new.jpg ")
    addAnime("no-cover", null)
    addAnime("blank", "  ")
    addAnime("null-text", "null")
    addAnime("inactive", "/c/inactive.jpg", activo = 0)
    val downloads = ScriptedDownloads { image() }

    val landed = prefetcher(downloads).prefetch(config)

    assertEquals(1, landed)
    assertEquals(listOf("http://10.0.0.2:3000/api/animes/new/cover"), downloads.urls)
    assertTrue(jpeg.contentEquals(File(inbox, "new.jpg").readBytes()))
    val sidecar = JSONObject(File(inbox, "new.json").readText())
    assertEquals(COVER_INBOX_ENTRY_VERSION, sidecar.getInt("version"))
    assertEquals("new", sidecar.getString("animeId"))
    assertEquals("new.jpg", sidecar.getString("imageFileName"))
    assertEquals("\"e1\"", sidecar.getString("etag"))
    assertEquals("/c/new.jpg", sidecar.getString("sourceKey"))
    assertEquals(1_000L, sidecar.getLong("fetchedAt"))
    assertFalse(File(inbox, "new.jpg.tmp").exists())
    assertFalse(File(inbox, "new.json.tmp").exists())
  }

  @Test
  fun `a missing ETag is written as null`() {
    addAnime("a", "/c/a.jpg")

    prefetcher(ScriptedDownloads { image(etag = null) }).prefetch(config)

    assertTrue(JSONObject(File(inbox, "a.json").readText()).isNull("etag"))
  }

  @Test
  fun `staged animes the list does not hold yet are downloaded, and staged removals are not`() {
    addAnime("listed-then-deleted", "/c/1.jpg")
    addAnime("listed-then-inactive", "/c/2.jpg")
    addAnime("listed-then-uncovered", "/c/3.jpg")
    stage("staged-new", "insert", """{"_id":"staged-new","activo":1,"portada":"/c/new.jpg"}""")
    stage("listed-then-deleted", "delete", null)
    stage("listed-then-inactive", "update", """{"activo":0,"portada":"/c/2.jpg"}""")
    stage("listed-then-uncovered", "update", """{"activo":1,"portada":null}""")
    stage("staged-broken", "update", "not json")
    stage("staged-snapshotless", "update", null)
    val downloads = ScriptedDownloads { image() }

    prefetcher(downloads).prefetch(config)

    assertEquals(listOf("http://10.0.0.2:3000/api/animes/staged-new/cover"), downloads.urls)
  }

  @Test
  fun `the latest staged change for an anime wins`() {
    stage("a", "insert", """{"activo":1,"portada":"/c/old.jpg"}""")
    stage("a", "update", """{"activo":1,"portada":"/c/new.jpg"}""")

    prefetcher(ScriptedDownloads { image() }).prefetch(config)

    assertEquals("/c/new.jpg", JSONObject(File(inbox, "a.json").readText()).getString("sourceKey"))
  }

  @Test
  fun `a store without the staging table still prefetches the listed animes`() {
    db.execSQL("DROP TABLE pending_remote_changes")
    addAnime("a", "/c/a.jpg")

    assertEquals(1, prefetcher(ScriptedDownloads { image() }).prefetch(config))
  }

  @Test
  fun `an anime already waiting in the inbox is not downloaded again`() {
    addAnime("a", "/c/a.jpg")
    inbox.mkdirs()
    File(inbox, "a.json").writeText("{}")
    val downloads = ScriptedDownloads { image() }

    assertEquals(0, prefetcher(downloads).prefetch(config))
    assertTrue(downloads.urls.isEmpty())
  }

  @Test
  fun `one attempt downloads at most the per-attempt cap`() {
    for (index in 1..5) addAnime("a$index", "/c/$index.jpg")
    val downloads = ScriptedDownloads { image() }

    assertEquals(COVER_PREFETCH_MAX_PER_ATTEMPT, prefetcher(downloads).prefetch(config))
    assertEquals(COVER_PREFETCH_MAX_PER_ATTEMPT, downloads.urls.size)
  }

  @Test
  fun `a cover that is not an image lands nothing and waits out the retry window`() {
    addAnime("absent", "/c/a.jpg")
    addAnime("empty", "/c/e.jpg")
    var now = 1_000L
    val downloads = ScriptedDownloads { url ->
      if (url.contains("absent")) SyncEngineBinaryResponse(204, null, null) else SyncEngineBinaryResponse(200, ByteArray(0), null)
    }
    val prefetch = prefetcher(downloads) { now }

    assertEquals(0, prefetch.prefetch(config))
    assertEquals(2, downloads.urls.size)
    assertFalse(inbox.exists())

    now += COVER_PREFETCH_RETRY_MS - 1
    prefetch.prefetch(config)
    assertEquals(2, downloads.urls.size)

    now += 1
    prefetch.prefetch(config)
    assertEquals(4, downloads.urls.size)
  }

  @Test
  fun `a transport failure stops the attempt`() {
    addAnime("a1", "/c/1.jpg")
    addAnime("a2", "/c/2.jpg")
    val downloads = ScriptedDownloads { throw IOException("unreachable") }

    assertEquals(0, prefetcher(downloads).prefetch(config))
    assertEquals(1, downloads.urls.size)
  }

  @Test
  fun `a 401 stops the attempt`() {
    addAnime("a1", "/c/1.jpg")
    addAnime("a2", "/c/2.jpg")
    val downloads = ScriptedDownloads { SyncEngineBinaryResponse(401, null, null) }

    assertEquals(0, prefetcher(downloads).prefetch(config))
    assertEquals(1, downloads.urls.size)
  }

  @Test
  fun `an unreadable manifest downloads nothing`() {
    File(filesDir, COVERS_DIRECTORY_NAME).apply { mkdirs() }.resolve(COVER_MANIFEST_FILE_NAME).writeText("{")
    addAnime("a", "/c/a.jpg")
    val downloads = ScriptedDownloads { image() }

    assertEquals(0, prefetcher(downloads).prefetch(config))
    assertTrue(downloads.urls.isEmpty())
  }

  @Test
  fun `an inbox that cannot be written fails the write instead of leaving a half pair`() {
    addAnime("a", "/c/a.jpg")
    inbox.mkdirs()
    File(inbox, "a.jpg").mkdirs() // a directory where the image must go: the rename fails

    var thrown: Throwable? = null
    try {
      prefetcher(ScriptedDownloads { image() }).prefetch(config)
    } catch (error: IllegalStateException) {
      thrown = error
    }

    assertTrue(thrown != null)
    assertFalse(File(inbox, "a.json").exists())
    assertFalse(File(inbox, "a.jpg.tmp").exists())
  }

  @Test
  fun `ids are escaped for file names and encoded for the route like the JS side`() {
    assertEquals("abc-XYZ09", coverInboxBaseName("abc-XYZ09"))
    assertEquals("a_005fb_002fc_00e9", coverInboxBaseName("a_b/cé"))
    assertEquals("http://10.0.0.2:3000/api/animes/a%20b%2Fc/cover", coverUrl(config, "a b/c"))
  }

  @Test
  fun `cover sources normalize like normalizeCoverSourceKey`() {
    assertNull(normalizeCoverSourceKey(null))
    assertNull(normalizeCoverSourceKey("   "))
    assertNull(normalizeCoverSourceKey(" null "))
    assertEquals("/c/a.jpg", normalizeCoverSourceKey(" /c/a.jpg "))
  }

  // ---- wiring ----

  @Test
  fun `the shared prefetch is reused for the same store and rebuilt for another`() {
    val first = SyncEngineCoverPrefetch.shared(db, filesDir)

    assertSame(first, SyncEngineCoverPrefetch.shared(db, filesDir))
    assertNotSame(first, SyncEngineCoverPrefetch.shared(db, File(filesDir, "other")))
  }

  @Test
  fun `the catch-up does nothing without a complete bridge connection`() {
    db.execSQL(
      "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
        "token TEXT, last_changelog_id INTEGER, is_sync_telemetry_enabled INTEGER)",
    )
    seedSeasonCache()

    SyncEngineBackgroundCatchUp.run(filesDir, db)
    db.execSQL("INSERT INTO bridge_config (id, ip, port) VALUES (1, '127.0.0.1', '1')")
    SyncEngineBackgroundCatchUp.run(filesDir, db)

    assertEquals("old-season" to "[]", cachedSeason())
  }

  @Test
  fun `the catch-up survives an absent bridge and keeps what it had`() {
    val closedPort = ServerSocket(0).use { it.localPort }
    db.execSQL(
      "CREATE TABLE bridge_config (id INTEGER PRIMARY KEY, device_id TEXT, ip TEXT, port TEXT, " +
        "token TEXT, last_changelog_id INTEGER, is_sync_telemetry_enabled INTEGER)",
    )
    db.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token) VALUES (1, 'd', '127.0.0.1', ?, 't')",
      arrayOf(closedPort.toString()),
    )
    seedSeasonCache()
    addAnime("a", "/c/a.jpg")

    SyncEngineBackgroundCatchUp.run(filesDir, db)

    assertEquals("old-season" to "[]", cachedSeason())
    assertFalse(inbox.exists())
  }

  @Test
  fun `the catch-up never throws, even when the store is unusable`() {
    db.close()

    SyncEngineBackgroundCatchUp.run(filesDir, db)
  }
}
