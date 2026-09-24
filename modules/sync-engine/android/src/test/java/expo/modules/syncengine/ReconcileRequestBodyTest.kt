package expo.modules.syncengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReconcileRequestBodyTest {
  @Test
  fun omitsUnknownBaseButPreservesAnExplicitZeroToken() {
    val body = ReconcileRequestBody.build(
      deviceId = "device-1",
      lastChangelogId = 12,
      rows = listOf(
        row(id = 1, animeId = "unknown", payload = "{}"),
        row(id = 2, animeId = "zero", payload = "{}"),
        row(id = 3, animeId = "null-token", payload = "{}"),
      ),
      tokensByAnimeId = mapOf("zero" to 0L, "null-token" to null),
      cycleId = "cycle-1",
      triggerSource = "manual",
    )
    val operations = body.getJSONArray("pending_operations")

    assertFalse(operations.getJSONObject(0).has("base"))
    assertTrue(operations.getJSONObject(1).has("base"))
    assertEquals(0L, operations.getJSONObject(1).getLong("base"))
    assertFalse(operations.getJSONObject(2).has("base"))
  }

  @Test
  fun normalizesAliasesOnlyForUpdatesAndLetsEnglishValuesWin() {
    val body = ReconcileRequestBody.build(
      deviceId = "device-1",
      lastChangelogId = 12,
      rows = listOf(
        row(
          id = 1,
          animeId = "update-row",
          operation = "update",
          payload = """{"estado":2,"status":5,"nrocapvisto":7,"dias":["Tue"]}""",
        ),
        row(
          id = 2,
          animeId = "create-row",
          operation = "create",
          payload = """{"estado":2}""",
        ),
      ),
      tokensByAnimeId = emptyMap(),
      cycleId = "cycle-1",
      triggerSource = "manual",
    )
    val operations = body.getJSONArray("pending_operations")
    val updatePayload = operations.getJSONObject(0).getJSONObject("payload")
    val createPayload = operations.getJSONObject(1).getJSONObject("payload")

    assertEquals(5, updatePayload.getInt("status"))
    assertEquals(7, updatePayload.getInt("episodesWatched"))
    assertEquals("Tue", updatePayload.getJSONArray("days").getString(0))
    assertFalse(updatePayload.has("estado"))
    assertFalse(updatePayload.has("nrocapvisto"))
    assertFalse(updatePayload.has("dias"))
    assertEquals(2, createPayload.getInt("estado"))
    assertFalse(createPayload.has("status"))
  }

  @Test
  fun malformedPayloadFallsBackToAnEmptyObject() {
    val body = ReconcileRequestBody.build(
      deviceId = "device-1",
      lastChangelogId = 12,
      rows = listOf(row(id = 1, animeId = "broken", payload = "{not-json")),
      tokensByAnimeId = emptyMap(),
      cycleId = "cycle-1",
      triggerSource = "manual",
    )

    assertEquals("{}", body.getJSONArray("pending_operations")
      .getJSONObject(0)
      .getJSONObject("payload")
      .toString())
  }

  private fun row(
    id: Long,
    animeId: String,
    operation: String = "update",
    payload: String,
  ) = BacklogRow(
    id = id,
    animeId = animeId,
    operation = operation,
    payload = payload,
    status = "processing",
    createdAt = 100 + id,
    conflictAttemptCount = 0,
  )
}
