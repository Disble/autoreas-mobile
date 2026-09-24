package expo.modules.syncengine

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Shared golden-fixture contract between this Kotlin engine and the JS engine
 * (`tests/contract/sync/reconcile-wire-contract.test.ts`). Both suites read the SAME JSON files
 * under `tests/fixtures/sync-contract/` (wired into this module's test classpath as an extra
 * resources dir by `android/build.gradle`, never copied) and run them through their own
 * language's production functions -- `ReconcileRequestBody`, `ReconcileResponseParser`,
 * `ReconcileConfirmation` and `WireAnimeMapper` here -- so a change that makes one engine
 * disagree with the other fails a test on the side that drifted.
 *
 * Normalized projection (see the JS test's header for the full statement, kept identical here):
 * a response case's `bridgeChanges[]` compares `recordId`/`changeType`/`timestamp` verbatim,
 * `changedFields` in the LOCAL (Spanish) vocabulary, and `snapshot` mapped to the legacy shape (or
 * `null` when the change carried none). A request case's `expectedTelemetryProjection`, when
 * present, compares only `cycle_id`/`trigger_source`/`counters.pending_ops_count` -- the fields
 * both engines' `client_telemetry` envelopes actually share; Kotlin's envelope is a deliberately
 * minimal, deferred subset (see `ReconcileRequestBody.kt`'s header comment), so full-shape
 * equality across languages is never asserted for that field.
 *
 * Four fixture cases in `reconcile-response-divergence-cases.json` are documented, NOT fixed,
 * disagreements between the two engines (see the T2 report in
 * `odd/tasks/sync-core-test-assurance.md`'s Divergences section). This suite asserts Kotlin's
 * OWN half of each disagreement (`expectedDivergence.kotlin`); the JS suite asserts its own half.
 * A future fix to either side must edit the fixture and remove the marker, which is what makes it
 * fail loudly instead of going stale silently.
 */
@RunWith(RobolectricTestRunner::class)
class ReconcileWireContractTest {

  @Test
  fun requestCasesMatchFixtures() {
    val failures = mutableListOf<String>()
    val cases = loadFixtureArray("reconcile-request-cases.json")
    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      val name = testCase.getString("name")
      val input = testCase.getJSONObject("input")
      val expected = testCase.getJSONObject("expected")

      val body = ReconcileRequestBody.build(
        deviceId = input.getString("deviceId"),
        lastChangelogId = input.getLong("lastChangelogId"),
        rows = buildBacklogRows(input.getJSONArray("pendingOperations")),
        tokensByAnimeId = buildTokenMap(input),
        cycleId = input.getString("cycleId"),
        triggerSource = input.getString("triggerSource"),
      )

      if (!jsonEquals(expected.get("device_id"), body.get("device_id"))) {
        failures.add("$name: device_id mismatch")
      }
      if (!jsonEquals(expected.get("last_changelog_id"), body.get("last_changelog_id"))) {
        failures.add("$name: last_changelog_id mismatch")
      }
      val expectedOperations = expected.getJSONArray("pending_operations")
      val actualOperations = body.getJSONArray("pending_operations")
      if (!jsonEquals(expectedOperations, actualOperations)) {
        failures.add("$name: pending_operations mismatch (expected $expectedOperations, was $actualOperations)")
      }

      testCase.optJSONObject("expectedTelemetryProjection")?.let { projection ->
        failures.addAll(checkTelemetryProjection(name, projection, body.getJSONObject("client_telemetry")))
      }
    }
    assertTrue(failures.joinToString("\n"), failures.isEmpty())
  }

  @Test
  fun responseCasesMatchFixtures() {
    val failures = mutableListOf<String>()
    val cases = loadFixtureArray("reconcile-response-cases.json")
    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      val name = testCase.getString("name")
      val result = runResponseCase(testCase.getJSONObject("input"))
      if (result.rejected) {
        failures.add("$name: expected to parse successfully, but it was rejected")
        continue
      }
      failures.addAll(checkResponseResult(name, testCase.getJSONObject("expected"), result))
    }
    assertTrue(failures.joinToString("\n"), failures.isEmpty())
  }

  @Test
  fun rejectionCasesMatchFixtures() {
    val failures = mutableListOf<String>()
    val cases = loadFixtureArray("reconcile-rejection-cases.json")
    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      val name = testCase.getString("name")
      val result = runResponseCase(testCase.getJSONObject("input"))
      if (!result.rejected) {
        failures.add("$name: expected rejection, but it parsed successfully")
      }
    }
    assertTrue(failures.joinToString("\n"), failures.isEmpty())
  }

  @Test
  fun divergenceCasesMatchFixtures() {
    val failures = mutableListOf<String>()
    val cases = loadFixtureArray("reconcile-response-divergence-cases.json")
    for (index in 0 until cases.length()) {
      val testCase = cases.getJSONObject(index)
      val name = testCase.getString("name")
      val expectedKotlin = testCase.getJSONObject("expectedDivergence").getJSONObject("kotlin")
      val result = runResponseCase(testCase.getJSONObject("input"))

      val expectedRejected = expectedKotlin.getBoolean("rejected")
      if (result.rejected != expectedRejected) {
        failures.add("$name: expected rejected=$expectedRejected, was ${result.rejected}")
        continue
      }
      if (!expectedRejected) {
        failures.addAll(checkResponseResult(name, expectedKotlin, result))
      }
    }
    assertTrue(failures.joinToString("\n"), failures.isEmpty())
  }

  /** Checks one non-rejected response result against its (fixture) expected block. */
  private fun checkResponseResult(name: String, expected: JSONObject, result: ResponseCaseResult): List<String> {
    val failures = mutableListOf<String>()
    if (expected.has("last_changelog_id")) {
      if (result.lastChangelogId != expected.getLong("last_changelog_id")) {
        failures.add("$name: last_changelog_id mismatch (expected ${expected.getLong("last_changelog_id")}, was ${result.lastChangelogId})")
      }
    } else if (result.lastChangelogId != null) {
      failures.add("$name: expected last_changelog_id absent, was ${result.lastChangelogId}")
    }

    val expectedIds = expected.getJSONArray("confirmedOperationIds")
    val actualIds = JSONArray(result.confirmedOperationIds)
    if (!jsonEquals(expectedIds, actualIds)) {
      failures.add("$name: confirmedOperationIds mismatch (expected $expectedIds, was $actualIds)")
    }

    val expectedChanges = expected.getJSONArray("bridgeChanges")
    val actualChanges = JSONArray(result.bridgeChanges)
    if (!jsonEquals(expectedChanges, actualChanges)) {
      failures.add("$name: bridgeChanges mismatch (expected $expectedChanges, was $actualChanges)")
    }
    return failures
  }

  /** Checks the shared client_telemetry projection (cycle_id/trigger_source/pending_ops_count). */
  private fun checkTelemetryProjection(name: String, projection: JSONObject, telemetry: JSONObject): List<String> {
    val failures = mutableListOf<String>()
    if (telemetry.getString("cycle_id") != projection.getString("cycle_id")) {
      failures.add("$name: client_telemetry.cycle_id mismatch")
    }
    if (telemetry.getString("trigger_source") != projection.getString("trigger_source")) {
      failures.add("$name: client_telemetry.trigger_source mismatch")
    }
    val expectedCount = projection.getJSONObject("counters").getLong("pending_ops_count")
    val actualCount = telemetry.getJSONObject("counters").getLong("pending_ops_count")
    if (expectedCount != actualCount) {
      failures.add("$name: client_telemetry.counters.pending_ops_count mismatch")
    }
    return failures
  }

  /** The outcome of running one response fixture case through the full Kotlin pipeline. */
  private data class ResponseCaseResult(
    val rejected: Boolean,
    val lastChangelogId: Long?,
    val confirmedOperationIds: List<Long>,
    val bridgeChanges: List<JSONObject>,
  )

  /**
   * Runs one response fixture case through the full Kotlin pipeline: wire parse
   * (`ReconcileResponseParser`), confirmation (`ReconcileConfirmation`), and wire-to-legacy
   * normalization (`WireAnimeMapper`) -- the same three concerns the JS harness chains through
   * `ReconcileResponseSchema`/`getConfirmedOperationIds`/`mapWireAnimeToLegacyAnime`. Any
   * {@link ReconcileParseException} anywhere in the pipeline is reported as rejected.
   */
  private fun runResponseCase(input: JSONObject): ResponseCaseResult {
    return try {
      val rawBody = input.get("responseBody").toString()
      val parsed = ReconcileResponseParser.parse(rawBody)
      val backlog = buildBacklogRows(input.optJSONArray("backlog") ?: JSONArray())
      val confirmedIds = ReconcileConfirmation.getConfirmedOperationIds(backlog, parsed)
      val bridgeChanges = parsed.bridgeChanges.map { change ->
        val normalized = WireAnimeMapper.normalize(change)
        JSONObject().apply {
          put("recordId", normalized.recordId)
          put("changeType", normalized.changeType)
          put("changedFields", JSONArray(normalized.changedFieldsJson))
          put("snapshot", normalized.snapshotJson?.let { JSONObject(it) } ?: JSONObject.NULL)
          put("timestamp", normalized.timestamp)
        }
      }
      ResponseCaseResult(rejected = false, lastChangelogId = parsed.lastChangelogId, confirmedOperationIds = confirmedIds, bridgeChanges = bridgeChanges)
    } catch (error: ReconcileParseException) {
      ResponseCaseResult(rejected = true, lastChangelogId = null, confirmedOperationIds = emptyList(), bridgeChanges = emptyList())
    }
  }

  /** Builds `BacklogRow`s from a fixture's `pendingOperations`/`backlog` array (same row shape). */
  private fun buildBacklogRows(operations: JSONArray): List<BacklogRow> {
    val rows = mutableListOf<BacklogRow>()
    for (index in 0 until operations.length()) {
      val operation = operations.getJSONObject(index)
      rows.add(
        BacklogRow(
          id = operation.getLong("id"),
          animeId = operation.getString("animeId"),
          operation = operation.getString("operation"),
          payload = operation.getString("payload"),
          status = "processing",
          createdAt = operation.optLong("createdAt", 0L),
          conflictAttemptCount = 0,
        ),
      )
    }
    return rows
  }

  /** Builds the `animeId -> token` map from a request fixture's optional `bridgeTokensByAnimeId`. */
  private fun buildTokenMap(input: JSONObject): Map<String, Long?> {
    val tokens = input.optJSONObject("bridgeTokensByAnimeId") ?: return emptyMap()
    val map = mutableMapOf<String, Long?>()
    for (key in tokens.keys()) {
      map[key] = if (tokens.isNull(key)) null else tokens.getLong(key)
    }
    return map
  }

  /** Reads one JSON array fixture file from the test classpath (wired in by `android/build.gradle`). */
  private fun loadFixtureArray(fileName: String): JSONArray {
    val stream = this::class.java.classLoader?.getResourceAsStream(fileName)
      ?: throw IllegalStateException("fixture resource not found on classpath: $fileName")
    val text = stream.bufferedReader().use { it.readText() }
    return JSONArray(text)
  }

  /**
   * Structural JSON equality: numbers compare by value (never by exact Integer/Long/Double
   * representation -- org.json's own parser and this module's producers mix all three for the
   * same logical number), objects compare by exact key SET plus recursive value equality (so a
   * spuriously present or absent key, like an omitted `base`, is caught), and `JSONObject.NULL`
   * is treated as Kotlin `null`'s JSON counterpart on either side.
   */
  private fun jsonEquals(expected: Any?, actual: Any?): Boolean {
    val expectedValue = expected ?: JSONObject.NULL
    val actualValue = actual ?: JSONObject.NULL
    return when {
      expectedValue === JSONObject.NULL -> actualValue === JSONObject.NULL
      expectedValue is Number -> actualValue is Number && expectedValue.toDouble() == actualValue.toDouble()
      expectedValue is String -> actualValue is String && expectedValue == actualValue
      expectedValue is Boolean -> actualValue is Boolean && expectedValue == actualValue
      expectedValue is JSONArray -> actualValue is JSONArray && expectedValue.length() == actualValue.length() &&
        (0 until expectedValue.length()).all { jsonEquals(expectedValue.get(it), actualValue.get(it)) }
      expectedValue is JSONObject -> {
        // Android's bundled org.json has no keySet(); keys() returns a one-shot Iterator<String>.
        val expectedKeys = expectedValue.keys().asSequence().toSet()
        actualValue is JSONObject && expectedKeys == actualValue.keys().asSequence().toSet() &&
          expectedKeys.all { jsonEquals(expectedValue.get(it), actualValue.opt(it)) }
      }
      else -> expectedValue == actualValue
    }
  }
}
