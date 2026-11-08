package expo.modules.foregroundsyncticker

import org.json.JSONArray
import org.json.JSONObject

/** One `counts[]` item of an hourly summary: one trigger source and outcome pair. */
data class SyncDiaryCount(
  val triggerSource: String,
  val outcome: String,
  val count: Long,
  val maxDurationMs: Long?,
)

/** One `process_deaths[]` item of an hourly summary. */
data class SyncDiaryProcessDeath(
  val processName: String,
  val reason: String,
  val count: Long,
)

/** One `runtime_transition` observation, already validated against the agreed pairs. */
data class SyncDiaryTransition(
  val observationId: String,
  val observedAtMs: Long,
  val processName: String,
  val subject: String,
  val transition: String,
  val reason: String?,
  val appVersion: String,
)

/**
 * Builds the `hourly_summary` body (Bridge schema `SyncDiagnosticsHourlySummary`). Every number is
 * clamped to the Bridge's bounds, and `process_deaths` is omitted when the hour saw none, since the
 * key is optional and the Bridge stores `[]` for it either way. The item caps
 * ([SYNC_DIARY_MAX_COUNT_ITEMS], [SYNC_DIARY_MAX_DEATH_ITEMS]) are applied by the diary's reads.
 */
fun buildSyncDiaryHourlySummary(
  observationId: String,
  hourStartMs: Long,
  counts: List<SyncDiaryCount>,
  droppedCount: Long,
  processDeaths: List<SyncDiaryProcessDeath>,
): String {
  val body = JSONObject()
    .put("kind", "hourly_summary")
    .put("observation_id", observationId)
    .put("hour_start_ms", hourStartMs)
    .put("counts", JSONArray(counts.map(::countJson)))
    .put("dropped_count", droppedCount.coerceIn(0L, SYNC_DIARY_MAX_COUNT))
  if (processDeaths.isNotEmpty()) {
    body.put("process_deaths", JSONArray(processDeaths.map(::deathJson)))
  }
  return body.toString()
}

/**
 * Builds the `runtime_transition` body (Bridge schema `SyncDiagnosticsRuntimeTransition`). The
 * optional `reason` is omitted when there is none.
 */
fun buildSyncDiaryRuntimeTransition(transition: SyncDiaryTransition): String {
  val body = JSONObject()
    .put("kind", "runtime_transition")
    .put("observation_id", transition.observationId)
    .put("observed_at_ms", transition.observedAtMs)
    .put("process_name", transition.processName)
    .put("subject", transition.subject)
    .put("transition", transition.transition)
  transition.reason?.let { reason -> body.put("reason", reason) }
  return body.put("app_version", transition.appVersion).toString()
}

/** One `counts[]` item, `max_duration_ms` omitted when unknown. */
private fun countJson(count: SyncDiaryCount): JSONObject {
  val item = JSONObject()
    .put("trigger_source", count.triggerSource)
    .put("outcome", count.outcome)
    .put("count", count.count.coerceIn(0L, SYNC_DIARY_MAX_COUNT))
  count.maxDurationMs?.let { duration ->
    item.put("max_duration_ms", duration.coerceIn(0L, SYNC_DIARY_MAX_DURATION_MS))
  }
  return item
}

/** One `process_deaths[]` item. */
private fun deathJson(death: SyncDiaryProcessDeath): JSONObject =
  JSONObject()
    .put("process_name", death.processName)
    .put("reason", death.reason)
    .put("count", death.count.coerceIn(1L, SYNC_DIARY_MAX_COUNT))
