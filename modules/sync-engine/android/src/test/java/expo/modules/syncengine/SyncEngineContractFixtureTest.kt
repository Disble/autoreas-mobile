package expo.modules.syncengine

import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.SQLiteMode

/**
 * The shared contract fixtures (ADR 009 R-4, R-10), run in the `:sync` runtime. The Jest runner
 * (`tests/behaviour/sync/contract-fixtures.behaviour.test.ts`) reads the SAME files under
 * `tests/contract-fixtures/` (wired in as a test resources dir by `build.gradle`, never copied)
 * and asserts the same `expect` block, so behaviour both runtimes share is pinned once.
 *
 * Each cycle gets its own bridge: a cycle scripted as a single refused connection points the
 * config at a closed port; any other cycle gets a scripted server whose script ends in an
 * `unscripted` 500, so a request the fixture did not intend is recorded and fails the comparison.
 * A refused request reaches no bridge, so it is never part of `expect.requests` in either runner.
 *
 * Every fixture runs in both runtimes (`runtimes` lists both): a fixture this runtime would skip
 * is a failure, never an assumption.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class SyncEngineContractFixtureTest(private val resourcePath: String) {

  @Test
  fun matchesTheSharedExpectation() {
    val fixture = JSONObject(readResource(resourcePath))
    assertEquals("every fixture runs in both runtimes", listOf("js", "kotlin"), fixture.getJSONArray("runtimes").toStringList().sorted())

    val given = fixture.getJSONObject("given")
    val cycles = fixture.getJSONArray("cycles")
    val expected = fixture.getJSONObject("expect")

    SyncEngineTestDatabase().use { database ->
      seed(database, given)
      val attempts = JSONArray()
      val requests = JSONArray()
      for (index in 0 until cycles.length()) {
        val cycle = cycles.getJSONObject(index)
        val outcome = runCycle(database, fixture.getString("name"), index, cycle.getJSONArray("bridge"), requests)
        attempts.put(if (cycle.has("attempt")) outcome else JSONObject.NULL)
      }

      val expectedView = JSONObject().put("attempts", expectedAttempts(cycles)).put("requests", expected.getJSONArray("requests"))
      val actualView = JSONObject().put("attempts", attempts).put("requests", requests)
      for (key in STATE_KEYS) {
        if (expected.has(key)) {
          expectedView.put(key, expected.get(key))
          actualView.put(key, readState(database, given, key))
        }
      }
      // Both renderings in full: a JUnit ComparisonFailure elides the middle of long strings.
      val expectedText = canonical(expectedView)
      val actualText = canonical(actualView)
      val report = listOf(fixture.getString("description"), "expected: $expectedText", "actual:   $actualText")
      assertTrue(report.joinToString(System.lineSeparator()), expectedText == actualText)
    }
  }

  /** Runs one attempt against this cycle's bridge, appending the answered requests; reports its outcome. */
  private fun runCycle(
    database: SyncEngineTestDatabase,
    name: String,
    index: Int,
    steps: JSONArray,
    requests: JSONArray,
  ): String {
    val refused = (0 until steps.length()).map { steps.getJSONObject(it).has("transport") }
    if (refused.any { it }) {
      check(steps.length() == 1) { "$name: the Kotlin runner refuses a connection only for a whole cycle" }
      setPort(database, closedPort())
      return attempt(database, name, index)
    }

    val script = (0 until steps.length()).map { toResponse(steps.getJSONObject(it)) } + UNSCRIPTED
    return SyncEngineTestHttpServer.scripted(script).use { server ->
      setPort(database, server.port)
      val outcome = attempt(database, name, index)
      server.requests.forEach { requests.put(project(it)) }
      outcome
    }
  }

  private fun attempt(database: SyncEngineTestDatabase, name: String, index: Int): String =
    when (val outcome = SyncEngineCycle(database.appDatabase, database.journal).run("foreground", "$name-$index") {}.outcome) {
      "closed" -> "succeeded"
      "failed" -> "failed"
      else -> outcome
    }

  private fun expectedAttempts(cycles: JSONArray): JSONArray = JSONArray().apply {
    for (index in 0 until cycles.length()) put(cycles.getJSONObject(index).opt("attempt") ?: JSONObject.NULL)
  }

  private fun seed(database: SyncEngineTestDatabase, given: JSONObject) {
    val db = database.appDatabase
    db.execSQL(
      "INSERT INTO bridge_config (id, device_id, ip, port, token, last_changelog_id) VALUES (1, 'device-1', '127.0.0.1', '0', 'token-1', ?)",
      arrayOf<Any>(given.getLong("cursor")),
    )
    val animes = given.getJSONArray("animes")
    for (index in 0 until animes.length()) {
      val anime = animes.getJSONObject(index)
      db.execSQL(
        "INSERT INTO animes (_id, bridge_modified_at) VALUES (?, ?)",
        arrayOf<Any?>(anime.getString("id"), if (anime.isNull("token")) null else anime.getLong("token")),
      )
    }
    val outbox = given.getJSONArray("outbox")
    val now = System.currentTimeMillis()
    for (index in 0 until outbox.length()) {
      val row = outbox.getJSONObject(index)
      db.execSQL(
        "INSERT INTO operation_log (anime_id, operation, payload, status, created_at, conflict_attempt_count) " +
          "VALUES (?, ?, ?, 'pending', ?, ?)",
        arrayOf<Any>(
          row.getString("animeId"),
          row.optString("operation", "update"),
          row.getJSONObject("payload").toString(),
          now + index,
          row.optLong("conflictAttemptCount", 0),
        ),
      )
    }
  }

  private fun setPort(database: SyncEngineTestDatabase, port: Int) {
    database.appDatabase.execSQL("UPDATE bridge_config SET port = ? WHERE id = 1", arrayOf<Any>(port.toString()))
  }

  /** Reads back one state key in the fixture's shape. */
  private fun readState(database: SyncEngineTestDatabase, given: JSONObject, key: String): Any = when (key) {
    "outbox" -> query(database, "SELECT anime_id, status, unresolved_reason, claim_owner, conflict_attempt_count FROM operation_log ORDER BY id") {
      JSONObject()
        .put("animeId", it.getString(0))
        .put("status", it.getString(1))
        .put("unresolvedReason", if (it.isNull(2)) JSONObject.NULL else it.getString(2))
        .put("claimOwner", if (it.isNull(3)) JSONObject.NULL else it.getString(3))
        .put("conflictAttemptCount", it.getLong(4))
    }.let { JSONArray(it) }
    "cursor" -> query(database, "SELECT last_changelog_id FROM bridge_config WHERE id = 1") { it.getLong(0) }.single()
    "tokens" -> JSONObject().apply {
      val animes = given.getJSONArray("animes")
      for (index in 0 until animes.length()) {
        val id = animes.getJSONObject(index).getString("id")
        val token = query(database, "SELECT bridge_modified_at FROM animes WHERE _id = '$id'") {
          if (it.isNull(0)) JSONObject.NULL else it.getLong(0)
        }.single()
        put(id, token)
      }
    }
    "staged" -> if (stagingTableExists(database)) {
      JSONArray(query(database, "SELECT record_id FROM pending_remote_changes ORDER BY id") { it.getString(0) })
    } else {
      JSONArray()
    }
    else -> error("the Kotlin runner reads no '$key' state yet")
  }

  private fun stagingTableExists(database: SyncEngineTestDatabase): Boolean =
    query(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_remote_changes'") { it.getString(0) }
      .isNotEmpty()

  private fun <T> query(database: SyncEngineTestDatabase, sql: String, map: (android.database.Cursor) -> T): List<T> =
    database.appDatabase.rawQuery(sql, null).use { cursor ->
      buildList { while (cursor.moveToNext()) add(map(cursor)) }
    }

  /** Projects one received request to the fields both runtimes share: never `created_at`. */
  private fun project(request: SyncEngineTestHttpServer.Request): JSONObject {
    val projected = JSONObject().put("method", request.method).put("path", request.path)
    if (request.method == "GET") return projected
    val body = JSONObject(request.body)
    if (request.path != RECONCILE_PATH) return projected.put("body", body)
    val operations = body.getJSONArray("pending_operations")
    return projected
      .put("lastChangelogId", body.getLong("last_changelog_id"))
      .put(
        "operations",
        JSONArray(
          (0 until operations.length()).map { index ->
            val operation = operations.getJSONObject(index)
            JSONObject()
              .put("anime_id", operation.get("anime_id"))
              .put("operation", operation.get("operation"))
              .put("payload", operation.get("payload"))
              .apply { if (operation.has("base")) put("base", operation.get("base")) }
          },
        ),
      )
  }

  private fun toResponse(step: JSONObject): SyncEngineTestHttpServer.Response =
    SyncEngineTestHttpServer.Response(step.getInt("status"), if (step.isNull("body")) "" else step.get("body").toString())

  private fun closedPort(): Int = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }

  private fun JSONArray.toStringList(): List<String> = (0 until length()).map { getString(it) }

  companion object {
    private const val RECONCILE_PATH = "/api/sync/reconcile"
    private val STATE_KEYS = listOf("outbox", "cursor", "tokens", "staged")
    private val GROUPS = listOf("anime-outbox", "season-rating")
    private val UNSCRIPTED = SyncEngineTestHttpServer.Response(500, """{"error":"unscripted request"}""")

    /** One parameter per fixture file, named `<group>/<file>`, every group in file-name order. */
    @JvmStatic
    @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
    fun fixtures(): List<Array<Any>> {
      val loader = SyncEngineContractFixtureTest::class.java.classLoader ?: error("no class loader")
      val files = GROUPS.flatMap { group ->
        val directory = loader.getResource(group) ?: error("contract fixture group not on the classpath: $group")
        val entries = File(directory.toURI()).listFiles { file -> file.name.endsWith(".json") }
          ?: error("cannot list contract fixture group: $group")
        entries.map { "$group/${it.name}" }.sorted()
      }
      assertTrue("no contract fixtures found", files.isNotEmpty())
      return files.map { arrayOf<Any>(it) }
    }

    private fun readResource(path: String): String {
      val stream = SyncEngineContractFixtureTest::class.java.classLoader?.getResourceAsStream(path)
        ?: error("contract fixture not on the classpath: $path")
      return stream.bufferedReader().use { it.readText() }
    }

    /**
     * A key-sorted rendering, so two structurally equal JSON values print the same and a
     * mismatch shows as a readable string diff. Numbers print by value (`7` whether Int or Long).
     */
    internal fun canonical(value: Any?): String = when (value) {
      null, JSONObject.NULL -> "null"
      is JSONObject -> value.keys().asSequence().sorted().joinToString(",", "{", "}") {
        JSONObject.quote(it) + ":" + canonical(value.get(it))
      }
      is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
      is String -> JSONObject.quote(value)
      is Number -> if (value.toDouble() == Math.floor(value.toDouble())) value.toLong().toString() else value.toString()
      else -> value.toString()
    }
  }
}
