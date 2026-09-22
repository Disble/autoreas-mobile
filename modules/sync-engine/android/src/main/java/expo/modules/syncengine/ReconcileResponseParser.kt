package expo.modules.syncengine

import org.json.JSONArray
import org.json.JSONObject

/** Thrown when a bridge response violates the reconcile contract beyond lenient repair. */
class ReconcileParseException(message: String) : Exception(message)

/** One entry of the bridge's `applied_operations[]` (see `ReconcileAppliedOperationSchema`). */
data class AppliedOperationEntry(
  val animeId: String,
  val operation: String,
  val applied: Boolean,
  /**
   * Bridge-authored OCC token for this operation. PRESENCE, not truthiness: `null` means the
   * key is ABSENT; a parsed `0` is a real, legitimate token (see `collectConfirmedAnimeTokens`).
   */
  val modifiedAt: Long?,
  /** Rejection reason string; unknown values are tolerated, never guessed. */
  val reason: String?,
)

/** One entry of the bridge's `bridge_changes[]` (see `ReconcileAnimeChangeSchema`). */
data class BridgeChangeEntry(
  val recordId: String,
  val changeType: String,
  /** Raw WIRE field names, exactly as the bridge sent them. */
  val changedFields: List<String>,
  /** Raw WIRE snapshot object, or `null` when absent. */
  val snapshot: JSONObject?,
  val timestamp: Long,
)

/** The leniently parsed reconcile response (see `ReconcileResponseSchema`). */
data class ParsedReconcileResponse(
  val appliedOperations: List<AppliedOperationEntry>,
  val bridgeChanges: List<BridgeChangeEntry>,
  /** `null` when the key is absent or not a number; presence, not truthiness, is what counts. */
  val lastChangelogId: Long?,
)

/**
 * Parses the reconcile response leniently with `org.json`, mirroring the zod contract's
 * fallbacks (`ReconcileResponseSchema` + `ReconcileArrayFallback`): missing or null arrays
 * become empty, unknown keys are ignored, an unknown `reason` string is tolerated, and
 * `modified_at`/`last_changelog_id` PRESENCE (not truthiness) decides whether a token exists.
 *
 * A response whose required scalars are missing or mistyped (a `record_id` that is not a
 * string, a `change_type` outside the closed vocabulary, a non-numeric `timestamp`, an invalid
 * snapshot shape) throws {@link ReconcileParseException}: the caller treats that as a RETRYABLE
 * failed attempt (rows back to `pending`, never dead-lettered), exactly like the JS cycle
 * treats a failed `safeParse`.
 *
 * The wire→legacy snapshot mapping reproduces `mapWireAnimeToLegacyAnime` +
 * `normalizeWireAnimeChangedFields` (`anime-wire.helpers.ts`), because the JS staging write
 * (`stagePendingRemoteChanges`) receives NORMALIZED changes: the staged `changed_fields` use
 * the Spanish local vocabulary and the staged snapshot is the mapped legacy shape. Numeric
 * range constraints (e.g. `status` within 0..3) are NOT re-validated here — the foreground
 * drain's TypeScript merge boundary owns that validation; this parser only repairs shape.
 */
object ReconcileResponseParser {

  /** Parses a raw response body string; throws {@link ReconcileParseException} when unrepairable. */
  fun parse(body: String?): ParsedReconcileResponse {
    if (body.isNullOrBlank()) {
      throw ReconcileParseException("reconcile response body was empty")
    }

    val root = try {
      JSONObject(body)
    } catch (error: Throwable) {
      throw ReconcileParseException("reconcile response was not a JSON object")
    }

    return ParsedReconcileResponse(
      appliedOperations = parseAppliedOperations(root.optJSONArray("applied_operations")),
      bridgeChanges = parseBridgeChanges(root.optJSONArray("bridge_changes")),
      lastChangelogId = parseOptionalLong(root, "last_changelog_id"),
    )
  }

  /** Missing/null arrays become empty (the `ReconcileArrayFallback` contract). */
  private fun parseAppliedOperations(array: JSONArray?): List<AppliedOperationEntry> {
    if (array == null) return emptyList()
    val entries = mutableListOf<AppliedOperationEntry>()
    for (index in 0 until array.length()) {
      val entry = array.optJSONObject(index)
        ?: throw ReconcileParseException("applied_operations[$index] is not an object")
      val animeId = entry.optStringOrNull("anime_id")
        ?: throw ReconcileParseException("applied_operations[$index].anime_id missing")
      val operation = entry.optStringOrNull("operation")
        ?: throw ReconcileParseException("applied_operations[$index].operation missing")
      entries.add(
        AppliedOperationEntry(
          animeId = animeId,
          operation = operation,
          applied = entry.optBoolean("applied", false),
          modifiedAt = parseOptionalLong(entry, "modified_at"),
          reason = entry.optStringOrNull("reason"),
        ),
      )
    }
    return entries
  }

  /** Missing/null arrays become empty; the closed `change_type` vocabulary is enforced. */
  private fun parseBridgeChanges(array: JSONArray?): List<BridgeChangeEntry> {
    if (array == null) return emptyList()
    val entries = mutableListOf<BridgeChangeEntry>()
    for (index in 0 until array.length()) {
      val entry = array.optJSONObject(index)
        ?: throw ReconcileParseException("bridge_changes[$index] is not an object")
      val recordId = entry.optStringOrNull("record_id")
        ?: throw ReconcileParseException("bridge_changes[$index].record_id missing")
      val changeType = entry.optStringOrNull("change_type")
        ?: throw ReconcileParseException("bridge_changes[$index].change_type missing")
      if (changeType != "create" && changeType != "update" && changeType != "delete") {
        throw ReconcileParseException("bridge_changes[$index].change_type invalid: $changeType")
      }
      val timestamp = parseOptionalLong(entry, "timestamp")
        ?: throw ReconcileParseException("bridge_changes[$index].timestamp missing")
      val snapshot = entry.optJSONObject("snapshot")
      if (entry.has("snapshot") && !entry.isNull("snapshot") && snapshot == null) {
        throw ReconcileParseException("bridge_changes[$index].snapshot is not an object")
      }
      entries.add(
        BridgeChangeEntry(
          recordId = recordId,
          changeType = changeType,
          changedFields = parseStringArray(entry.optJSONArray("changed_fields")),
          snapshot = snapshot,
          timestamp = timestamp,
        ),
      )
    }
    return entries
  }

  /** Reads an optional number field; `null` when the key is absent, null, or not a number. */
  private fun parseOptionalLong(obj: JSONObject, key: String): Long? {
    if (!obj.has(key) || obj.isNull(key)) return null
    val value = obj.opt(key)
    return when (value) {
      is Number -> value.toLong()
      is String -> value.toDoubleOrNull()?.toLong()
      else -> null
    }
  }

  private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val value = opt(key)
    return value as? String
  }

  /** A missing/null/'' array becomes empty; non-string members are dropped. */
  private fun parseStringArray(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val fields = mutableListOf<String>()
    for (index in 0 until array.length()) {
      val value = array.opt(index)
      if (value is String) fields.add(value)
    }
    return fields
  }
}

/**
 * Maps one raw WIRE bridge change into the normalized `RemoteAnimeChange` staging shape, i.e.
 * what `normalizeBridgeChange` + `stagePendingRemoteChanges` write together on the JS side.
 * The returned `changedFields` use the Spanish local vocabulary and the returned `snapshot`
 * is the mapped legacy shape (or `null` when the change carried none).
 */
data class NormalizedBridgeChange(
  val recordId: String,
  val changeType: String,
  val changedFieldsJson: String,
  val snapshotJson: String?,
  val timestamp: Long,
)

/** Wire field → Spanish local field, exactly `LOCAL_FIELD_BY_WIRE_FIELD` (`anime-wire.constants.ts`). */
private val LOCAL_FIELD_BY_WIRE_FIELD = mapOf(
  "id" to "_id",
  "name" to "nombre",
  "status" to "estado",
  "episodesWatched" to "nrocapvisto",
  "totalEpisodes" to "totalcap",
  "active" to "activo",
  "firstCycle" to "primeravez",
  "days" to "dias",
  "genres" to "generos",
  "kind" to "tipo",
  "lastWatchedAt" to "fechaUltCapVisto",
  "premieredAt" to "fechaEstreno",
  "createdAt" to "fechaCreacion",
  "deletedAt" to "fechaEliminacion",
  "cover" to "portada",
  "sourceUrl" to "pagina",
  "folder" to "carpeta",
  "studios" to "estudios",
  "origin" to "origen",
  "durationMinutes" to "duracion",
)

object WireAnimeMapper {

  /**
   * Normalizes one bridge change for staging: normalizes `changed_fields` into the local
   * vocabulary (unknown wire names are DROPPED, mirroring `normalizeWireAnimeChangedFields`'s
   * flatMap) and maps the snapshot into the legacy shape. Throws
   * {@link ReconcileParseException} when a snapshot is present but lacks its required scalars
   * — same retryable-failure semantics as a failed zod parse of the whole response.
   */
  fun normalize(change: BridgeChangeEntry): NormalizedBridgeChange {
    val normalizedFields = change.changedFields.mapNotNull { LOCAL_FIELD_BY_WIRE_FIELD[it] }
    return NormalizedBridgeChange(
      recordId = change.recordId,
      changeType = change.changeType,
      changedFieldsJson = org.json.JSONArray(normalizedFields).toString(),
      snapshotJson = change.snapshot?.let { mapToLegacy(it).toString() },
      timestamp = change.timestamp,
    )
  }

  /**
   * Maps one English wire anime snapshot into the stable Spanish local shape, reproducing
   * `mapWireAnimeToLegacyAnime` field by field, including the `dateLike` coercion (number,
   * numeric string, or `{ "$$date": n }` object, else `null`) and the legacy empty-string
   * sentinel → empty array for `days`/`genres`.
   */
  fun mapToLegacy(wire: JSONObject): JSONObject {
    val legacy = JSONObject()
    legacy.put("_id", requireString(wire, "id"))
    legacy.put("nombre", requireString(wire, "name"))
    legacy.put("estado", requireNumber(wire, "status"))
    legacy.put("nrocapvisto", requireNumber(wire, "episodesWatched"))
    legacy.put("totalcap", wire.opt("totalEpisodes") ?: JSONObject.NULL)
    legacy.put("dias", mapDays(wire.opt("days")))
    legacy.put("generos", mapStringArrayOrEmpty(wire.opt("genres")))
    legacy.put("tipo", wire.opt("kind") ?: JSONObject.NULL)
    legacy.put("activo", requireNumber(wire, "active"))
    legacy.put("primeravez", requireNumber(wire, "firstCycle"))
    legacy.put("fechaUltCapVisto", dateLike(wire, "lastWatchedAt"))
    legacy.put("fechaEstreno", dateLike(wire, "premieredAt"))
    legacy.put("fechaCreacion", dateLike(wire, "createdAt"))
    legacy.put("fechaEliminacion", dateLike(wire, "deletedAt"))
    legacy.put("portada", wire.opt("cover") ?: JSONObject.NULL)
    legacy.put("pagina", wire.opt("sourceUrl") ?: JSONObject.NULL)
    legacy.put("carpeta", wire.opt("folder") ?: JSONObject.NULL)
    legacy.put("estudios", wire.opt("studios") ?: JSONObject.NULL)
    legacy.put("origen", wire.opt("origin") ?: JSONObject.NULL)
    legacy.put("duracion", wire.opt("durationMinutes") ?: JSONObject.NULL)
    return legacy
  }

  /** A required string; absence throws (retryable parse failure), mirroring zod's required field. */
  private fun requireString(wire: JSONObject, key: String): Any {
    if (!wire.has(key) || wire.isNull(key)) {
      throw ReconcileParseException("snapshot.$key is required")
    }
    return wire.get(key)
  }

  /** A required number; absence or mistype throws (retryable parse failure). */
  private fun requireNumber(wire: JSONObject, key: String): Any {
    val value = wire.opt(key)
    if (value !is Number) {
      throw ReconcileParseException("snapshot.$key is required and must be a number")
    }
    return value
  }

  /**
   * Maps `days`: `[{"day","order"}]` → `[{"dia","orden"}]`, coercing the legacy empty-string
   * sentinel to `[]`. A present-but-not-array value throws (retryable).
   */
  private fun mapDays(value: Any?): Any {
    if (value == null || value == JSONObject.NULL) return JSONArray()
    if (value is String && value.isEmpty()) return JSONArray()
    if (value !is JSONArray) throw ReconcileParseException("snapshot.days must be an array")
    val mapped = JSONArray()
    for (index in 0 until value.length()) {
      val day = value.optJSONObject(index)
        ?: throw ReconcileParseException("snapshot.days[$index] is not an object")
      val entry = JSONObject()
      entry.put("dia", day.optString("day", ""))
      entry.put("orden", day.optDouble("order", 0.0))
      mapped.put(entry)
    }
    return mapped
  }

  /** Maps genres, coercing the legacy empty-string sentinel to `[]`. */
  private fun mapStringArrayOrEmpty(value: Any?): Any {
    if (value == null || value == JSONObject.NULL) return JSONArray()
    if (value is String && value.isEmpty()) return JSONArray()
    if (value !is JSONArray) throw ReconcileParseException("snapshot.genres must be an array")
    return value
  }

  /**
   * Coerces a date-like wire field: a number passes through, a numeric string is parsed, a
   * `{ "$$date": n }` object unwraps to its number, everything else (including `null`) becomes
   * `null`. Mirrors the shared `dateLike` preprocessor.
   */
  private fun dateLike(wire: JSONObject, key: String): Any {
    if (!wire.has(key)) return JSONObject.NULL
    val value = wire.get(key)
    return when (value) {
      is Number -> value
      is String -> value.trim().toDoubleOrNull() ?: JSONObject.NULL
      is JSONObject -> if (value.has("\$\$date")) value.opt("\$\$date") ?: JSONObject.NULL else JSONObject.NULL
      else -> JSONObject.NULL
    }
  }
}
