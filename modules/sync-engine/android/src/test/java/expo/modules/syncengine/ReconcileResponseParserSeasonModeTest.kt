package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * `season_mode` on the reconcile answer: an optional boolean, read exactly as the JS
 * `z.boolean().optional()` reads it (ADR 009 R-5). Absent is "not stated"; null or any
 * non-boolean rejects the whole answer.
 */
@RunWith(RobolectricTestRunner::class)
class ReconcileResponseParserSeasonModeTest {
  @Test
  fun parsesSeasonModeAndReadsAnAbsentOneAsNull() {
    assertEquals(true, ReconcileResponseParser.parse("""{"status":"accepted","season_mode":true}""").seasonMode)
    assertEquals(false, ReconcileResponseParser.parse("""{"status":"accepted","season_mode":false}""").seasonMode)
    assertEquals(null, ReconcileResponseParser.parse("""{"status":"accepted"}""").seasonMode)
  }

  @Test
  fun rejectsANullOrNonBooleanSeasonModeLikeTheJsSchema() {
    val malformed = listOf(
      """{"status":"accepted","season_mode":null}""",
      """{"status":"accepted","season_mode":"true"}""",
      """{"status":"accepted","season_mode":1}""",
    )

    val accepted = malformed.filter { body ->
      try {
        ReconcileResponseParser.parse(body)
        true
      } catch (expected: ReconcileParseException) {
        false
      }
    }

    assertEquals(emptyList<String>(), accepted)
  }
}
