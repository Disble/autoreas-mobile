package expo.modules.syncengine

import org.json.JSONObject
import org.json.JSONTokener

/**
 * One claimed operation-log backlog row, exactly the columns the deduped backlog query projects
 * (see `readOperationLogBacklog` / `buildDedupedBacklogQuery` in
 * `operation-log-retention.helpers.ts`).
 */
data class BacklogRow(
  val id: Long,
  val animeId: String,
  val operation: String,
  val payload: String,
  val status: String,
  val createdAt: Long,
  val conflictAttemptCount: Long,
)

/**
 * Builds the reconcile request body for the native engine, reproducing
 * `buildReconcileRequestBody` (`reconcile-request.helpers.ts`) byte-for-byte where it matters:
 * - `device_id`, `last_changelog_id`, `created_at` pass through;
 * - each payload is parsed leniently and legacy Spanish aliases are normalized for `update`
 *   operations ONLY (English key wins, the alias key is always removed; a non-object payload
 *   degrades to `{}`);
 * - `base` is OMITTED when the stored token is NULL and PRESENT (including 0) when known —
 *   never `"base": null`, because the bridge unmarshals null into a real zero token
 *   (see `buildOptimisticBaseKey`);
 * - a minimal `client_telemetry` envelope rides along. The full snapshot/events telemetry of
 *   the JS cycle is deliberately DEFERRED (documented in the module's KDoc), not silently
 *   dropped: the bridge tolerates the reduced envelope, and T5 unifies the two telemetry paths.
 */
object ReconcileRequestBody {

  /** Builds the full request body for one claimed batch. */
  fun build(
    deviceId: String,
    lastChangelogId: Long,
    rows: List<BacklogRow>,
    tokensByAnimeId: Map<String, Long?>,
    cycleId: String,
    triggerSource: String,
  ): JSONObject {
    val body = JSONObject()
    body.put("device_id", deviceId)
    body.put("last_changelog_id", lastChangelogId)

    val operations = org.json.JSONArray()
    for (row in rows) {
      val operation = JSONObject()
      operation.put("anime_id", row.animeId)
      operation.put("operation", row.operation)
      operation.put("payload", normalizePayload(row.operation, row.payload))
      operation.put("created_at", row.createdAt)
      val token = tokensByAnimeId[row.animeId]
      if (token != null) {
        operation.put("base", token)
      }
      operations.put(operation)
    }
    body.put("pending_operations", operations)

    val counters = JSONObject().put("pending_ops_count", rows.size)
    val telemetry = JSONObject()
      .put("cycle_id", cycleId)
      .put("trigger_source", triggerSource)
      .put("counters", counters)
    body.put("client_telemetry", telemetry)

    return body
  }

  /**
   * Parses one persisted payload column, which is free-form TEXT and therefore untrusted.
   * Anything that is not a JSON object — corrupt text, a bare array, a scalar — degrades to an
   * empty object instead of throwing, so a single bad row cannot abort the whole batch.
   */
  fun normalizePayload(operation: String, payload: String): JSONObject {
    val parsed = parseOperationPayload(payload)
    return if (operation == "update") normalizeLegacyAliases(parsed) else parsed
  }

  /** Parses the raw payload column; mirrors `parseOperationPayload`'s degradation to `{}`. */
  private fun parseOperationPayload(payload: String): JSONObject {
    return try {
      val token = JSONTokener(payload).nextValue()
      if (token is JSONObject) token else JSONObject()
    } catch (error: Throwable) {
      JSONObject()
    }
  }

  private const val ALIAS_STATUS = "estado"
  private const val ALIAS_EPISODES_WATCHED = "nrocapvisto"
  private const val ALIAS_LAST_WATCHED_AT = "fechaUltCapVisto"
  private const val ALIAS_DAYS = "dias"

  /**
   * Translates the legacy Spanish keys still written into local outbox payloads into the
   * English keys the wire contract accepts. The alias is always DELETED, even when no
   * translation happened. An English key already present wins over its alias: the caller that
   * wrote it spoke the current contract on purpose. Mirrors
   * `normalizeLegacyAnimeUpdatePayloadAliases` exactly.
   */
  private fun normalizeLegacyAliases(payload: JSONObject): JSONObject {
    val normalized = JSONObject(payload.toString())
    val aliases = mapOf(
      ALIAS_STATUS to "status",
      ALIAS_EPISODES_WATCHED to "episodesWatched",
      ALIAS_LAST_WATCHED_AT to "lastWatchedAt",
      ALIAS_DAYS to "days",
    )

    for ((legacyAlias, englishKey) in aliases) {
      if (!normalized.has(englishKey) && payload.has(legacyAlias)) {
        normalized.put(englishKey, payload.get(legacyAlias))
      }
      normalized.remove(legacyAlias)
    }

    return normalized
  }
}
