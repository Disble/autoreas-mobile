package expo.modules.syncengine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * [ReconcileConfirmation] had only indirect coverage before this file (T3,
 * sync-core-test-assurance), through [SyncEngineResponseApplierTest]'s end-to-end response
 * application. Pure-data tests: no SQLite -- but still `@RunWith(RobolectricTestRunner::class)`,
 * like every other `org.json.JSONObject`-touching test in this module (e.g.
 * [ReconcileRequestBodyTest]): `android.jar`'s own `org.json` classes are body-stripped stubs
 * ("Stub!") outside Robolectric, and `returnDefaultValues = true` (this module's
 * `testOptions.unitTests`) turns every stubbed call into a silent wrong-default instead of a
 * loud failure -- confirmed the hard way: without this annotation, `JSONObject#put` returned
 * `null` instead of `this`, and the confirmation paths that read a real `JSONObject` back
 * silently degraded to their empty defaults.
 */
@RunWith(RobolectricTestRunner::class)
class ReconcileConfirmationTest {

  @Test
  fun confirmsWhenAnAppliedOperationsEntryMatchesAndIsApplied() {
    val row = backlogRow(id = 1, animeId = "anime-1", operation = "create", payload = "{}")
    val parsed = parsedResponse(
      applied = listOf(appliedOperation("anime-1", "create", applied = true)),
    )

    assertEquals(listOf(1L), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun rejectsWhenTheMatchingAppliedOperationsEntrySaysNotAppliedEvenIfBridgeChangesWouldOtherwiseConfirm() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"name":"Naruto"}""",
    )
    val parsed = parsedResponse(
      applied = listOf(appliedOperation("anime-1", "create", applied = false)),
      changes = listOf(bridgeChange("anime-1", "create", changedFields = listOf("name"))),
    )

    // The applied_operations match wins outright -- isOperationConfirmed returns as soon as it
    // finds the entry, never falling through to the bridge_changes evidence pass.
    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun neverConfirmsByInferenceWhenThePayloadHasNoFields() {
    val row = backlogRow(id = 1, animeId = "anime-1", operation = "create", payload = "{}")
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("anime-1", "create", changedFields = emptyList())),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun confirmsByChangedFieldsEvidenceWhenTheFieldIsListedInTheBridgeChange() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"name":"Naruto"}""",
    )
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("anime-1", "update", changedFields = listOf("name"))),
    )

    assertEquals(listOf(1L), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun neverConfirmsFromADeleteChangeEvenWhenRecordIdMatches() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"name":"Naruto"}""",
    )
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("anime-1", "delete", changedFields = listOf("name"))),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun ignoresABridgeChangeForADifferentRecord() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"name":"Naruto"}""",
    )
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("anime-OTHER", "update", changedFields = listOf("name"))),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun confirmsBySnapshotEvidenceWhenTheFieldIsAbsentFromChangedFieldsButMatchesTheSnapshotValue() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"episodesWatched":12}""",
    )
    val snapshot = JSONObject().put("episodesWatched", 12)
    val parsed = parsedResponse(
      changes = listOf(
        bridgeChange("anime-1", "update", changedFields = emptyList(), snapshot = snapshot),
      ),
    )

    assertEquals(listOf(1L), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun rejectsSnapshotEvidenceWhenTheSnapshotValueDiffersFromThePayload() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"episodesWatched":12}""",
    )
    val snapshot = JSONObject().put("episodesWatched", 13)
    val parsed = parsedResponse(
      changes = listOf(
        bridgeChange("anime-1", "update", changedFields = emptyList(), snapshot = snapshot),
      ),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun rejectsWhenTheFieldIsAbsentFromBothChangedFieldsAndANullSnapshot() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"name":"Naruto"}""",
    )
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("anime-1", "update", changedFields = emptyList(), snapshot = null)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun requiresEveryPayloadFieldToBeEvidencedNotJustOne() {
    val row = backlogRow(
      id = 1,
      animeId = "anime-1",
      operation = "create",
      payload = """{"name":"Naruto","episodesWatched":12}""",
    )
    // Only "name" is evidenced; "episodesWatched" is neither in changedFields nor the snapshot.
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("anime-1", "update", changedFields = listOf("name"))),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun jsStrictEqualsComparesNumbersByValueAcrossIntAndDoubleRepresentations() {
    val row = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"n":5}""")
    val snapshot = JSONObject().put("n", 5.0) // parsed as Double, payload's "n" parses as Int
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(listOf(1L), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun jsStrictEqualsNeverMatchesObjectsOrArraysStructurallyOnlyByIdentity() {
    val row = backlogRow(
      id = 1,
      animeId = "a",
      operation = "create",
      payload = """{"days":[{"day":"mon"}]}""",
    )
    // Structurally identical array, but a DIFFERENT parsed instance -- jsStrictEquals falls to
    // `a === b` for non-number/string/boolean types, which a structural copy never satisfies.
    val snapshot = JSONObject().put("days", org.json.JSONArray("""[{"day":"mon"}]"""))
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun aggregatesConfirmedIdsAcrossMultipleBacklogRows() {
    val rowConfirmed = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"x":1}""")
    val rowUnconfirmed = backlogRow(id = 2, animeId = "b", operation = "create", payload = """{"x":1}""")
    val parsed = parsedResponse(
      applied = listOf(appliedOperation("a", "create", applied = true)),
    )

    assertEquals(
      listOf(1L),
      ReconcileConfirmation.getConfirmedOperationIds(listOf(rowConfirmed, rowUnconfirmed), parsed),
    )
  }

  @Test
  fun jsStrictEqualsComparesBooleansAndStringsByValue() {
    val row = backlogRow(
      id = 1,
      animeId = "a",
      operation = "create",
      payload = """{"active":true,"name":"x"}""",
    )
    val snapshot = JSONObject().put("active", true).put("name", "x")
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertTrue(
      ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed).contains(1L),
    )
  }

  @Test
  fun rejectsWhenTheSnapshotIsPresentButDoesNotHaveTheField() {
    val row = backlogRow(
      id = 1,
      animeId = "a",
      operation = "create",
      payload = """{"name":"Naruto"}""",
    )
    // snapshot exists (non-null) but carries a DIFFERENT field, not "name": `snapshot.has(field)`
    // must be false, not short-circuited away by the earlier `snapshot != null` check.
    val snapshot = JSONObject().put("other", "x")
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun rejectsWhenTheSnapshotHasTheFieldButItsValueIsJsonNull() {
    val row = backlogRow(
      id = 1,
      animeId = "a",
      operation = "create",
      payload = """{"name":"Naruto"}""",
    )
    val snapshot = JSONObject().put("name", JSONObject.NULL)
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun jsStrictEqualsNeverMatchesANumberAgainstAStringEvenWithTheSameDigits() {
    val row = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"n":5}""")
    val snapshot = JSONObject().put("n", "5") // string, not a number
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun jsStrictEqualsNeverMatchesAStringAgainstABoolean() {
    val row = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"flag":"true"}""")
    val snapshot = JSONObject().put("flag", true) // boolean, not a string
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun jsStrictEqualsNeverMatchesABooleanAgainstANumber() {
    val row = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"active":true}""")
    val snapshot = JSONObject().put("active", 1) // number, not a boolean
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  // The three mismatch tests above cover Number->String, String->Boolean, Boolean->Number; the
  // reverse-ordered pairs below round out every remaining `a is X && b is X` combination the
  // `when` in jsStrictEquals can take.
  @Test
  fun jsStrictEqualsNeverMatchesAStringAgainstANumber() {
    val row = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"n":"5"}""")
    val snapshot = JSONObject().put("n", 5)
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun jsStrictEqualsNeverMatchesABooleanAgainstAString() {
    val row = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"flag":true}""")
    val snapshot = JSONObject().put("flag", "true")
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun jsStrictEqualsNeverMatchesANumberAgainstABoolean() {
    val row = backlogRow(id = 1, animeId = "a", operation = "create", payload = """{"n":1}""")
    val snapshot = JSONObject().put("n", true)
    val parsed = parsedResponse(
      changes = listOf(bridgeChange("a", "update", changedFields = emptyList(), snapshot = snapshot)),
    )

    assertEquals(emptyList<Long>(), ReconcileConfirmation.getConfirmedOperationIds(listOf(row), parsed))
  }

  @Test
  fun aBacklogWithNoRowsConfirmsNothing() {
    assertFalse(
      ReconcileConfirmation.getConfirmedOperationIds(emptyList(), parsedResponse()).isNotEmpty(),
    )
  }

  private fun backlogRow(id: Long, animeId: String, operation: String, payload: String) = BacklogRow(
    id = id,
    animeId = animeId,
    operation = operation,
    payload = payload,
    status = "processing",
    createdAt = 0,
    conflictAttemptCount = 0,
  )

  private fun appliedOperation(animeId: String, operation: String, applied: Boolean) = AppliedOperationEntry(
    animeId = animeId,
    operation = operation,
    applied = applied,
    modifiedAt = null,
    reason = null,
  )

  private fun bridgeChange(
    recordId: String,
    changeType: String,
    changedFields: List<String>,
    snapshot: JSONObject? = null,
  ) = BridgeChangeEntry(
    recordId = recordId,
    changeType = changeType,
    changedFields = changedFields,
    snapshot = snapshot,
    timestamp = 0,
  )

  private fun parsedResponse(
    applied: List<AppliedOperationEntry> = emptyList(),
    changes: List<BridgeChangeEntry> = emptyList(),
  ) = ParsedReconcileResponse(
    appliedOperations = applied,
    bridgeChanges = changes,
    lastChangelogId = null,
  )
}
