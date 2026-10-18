package expo.modules.syncengine

import android.util.Log
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
  /**
   * The root `season_mode` (whether the bridge has a season open); `null` when the key is absent,
   * which leaves the stored value as it is. It travels only on this HTTP response.
   */
  val seasonMode: Boolean? = null,
)

/**
 * Parses the reconcile response with `org.json`, accepting exactly what the zod contract
 * (`ReconcileResponseSchema` + `ReconcileArrayFallback`) accepts, so both runtimes give a
 * malformed response the same fate (ADR 009 R-5): `status` must be a string; a missing or null
 * `applied_operations`/`bridge_changes`/`changed_fields` becomes empty, but any other non-array
 * value is malformed; unknown keys are ignored; an unknown `reason` string is tolerated; an
 * optional field (`modified_at`, `reason`, `last_changelog_id`, `season_mode`, `snapshot`) may be absent but
 * never null or of the wrong type; `modified_at` must be an integer. `modified_at` and
 * `last_changelog_id` PRESENCE (not truthiness) decides whether a token exists.
 *
 * Anything else (a mistyped or missing required field, a `change_type` outside the closed
 * vocabulary, an invalid snapshot shape) throws {@link ReconcileParseException}: the caller
 * treats that as a RETRYABLE failed attempt (rows back to `pending`, never dead-lettered, the
 * cursor kept, nothing staged), exactly like the JS cycle treats a failed `safeParse`. Pinned by
 * the shared fixtures under `tests/contract-fixtures/anime-outbox/malformed-2xx-*.json`.
 *
 * The wire→legacy snapshot mapping reproduces `mapWireAnimeToLegacyAnime` +
 * `normalizeWireAnimeChangedFields` (`anime-wire.helpers.ts`), because the JS staging write
 * (`stagePendingRemoteChanges`) receives NORMALIZED changes: the staged `changed_fields` use
 * the Spanish local vocabulary and the staged snapshot is the mapped legacy shape. Numeric
 * range constraints (e.g. `status` within 0..3) are NOT re-validated here — the foreground
 * drain's TypeScript merge boundary owns that validation; this parser only repairs shape.
 */
object ReconcileResponseParser {

  /** Parses a raw response body string; throws {@link ReconcileParseException} when malformed. */
  fun parse(body: String?): ParsedReconcileResponse {
    if (body.isNullOrBlank()) {
      throw ReconcileParseException("reconcile response body was empty")
    }

    val root = try {
      JSONObject(body)
    } catch (error: Throwable) {
      throw ReconcileParseException("reconcile response was not a JSON object")
    }

    requiredString(root, "status", "status")
    return ParsedReconcileResponse(
      appliedOperations = parseAppliedOperations(nullishArray(root, "applied_operations", "applied_operations")),
      bridgeChanges = parseBridgeChanges(nullishArray(root, "bridge_changes", "bridge_changes")),
      lastChangelogId = optionalNumber(root, "last_changelog_id", "last_changelog_id")?.toLong(),
      seasonMode = optionalBoolean(root, "season_mode", "season_mode"),
    )
  }

  /** Each entry of `applied_operations`, every field typed as `ReconcileAppliedOperationSchema`. */
  private fun parseAppliedOperations(array: JSONArray): List<AppliedOperationEntry> {
    val entries = mutableListOf<AppliedOperationEntry>()
    for (index in 0 until array.length()) {
      val path = "applied_operations[$index]"
      val entry = array.opt(index) as? JSONObject ?: throw ReconcileParseException("$path is not an object")
      entries.add(
        AppliedOperationEntry(
          animeId = requiredString(entry, "anime_id", "$path.anime_id"),
          operation = requiredString(entry, "operation", "$path.operation"),
          applied = entry.opt("applied") as? Boolean
            ?: throw ReconcileParseException("$path.applied is missing or not a boolean"),
          modifiedAt = optionalInteger(entry, "modified_at", "$path.modified_at"),
          reason = optionalString(entry, "reason", "$path.reason"),
        ),
      )
    }
    return entries
  }

  /** Each entry of `bridge_changes`; the closed `change_type` vocabulary is enforced. */
  private fun parseBridgeChanges(array: JSONArray): List<BridgeChangeEntry> {
    val entries = mutableListOf<BridgeChangeEntry>()
    for (index in 0 until array.length()) {
      val path = "bridge_changes[$index]"
      val entry = array.opt(index) as? JSONObject ?: throw ReconcileParseException("$path is not an object")
      val recordId = requiredString(entry, "record_id", "$path.record_id")
      val changeType = requiredString(entry, "change_type", "$path.change_type")
      if (changeType != "create" && changeType != "update" && changeType != "delete") {
        throw ReconcileParseException("$path.change_type invalid: $changeType")
      }
      val timestamp = entry.opt("timestamp") as? Number
        ?: throw ReconcileParseException("$path.timestamp is missing or not a number")
      val snapshot = if (entry.has("snapshot")) {
        entry.opt("snapshot") as? JSONObject ?: throw ReconcileParseException("$path.snapshot is not an object")
      } else {
        null
      }
      entries.add(
        BridgeChangeEntry(
          recordId = recordId,
          changeType = changeType,
          changedFields = parseStringArray(nullishArray(entry, "changed_fields", "$path.changed_fields"), "$path.changed_fields"),
          snapshot = snapshot,
          timestamp = timestamp.toLong(),
        ),
      )
    }
    return entries
  }

  /** `ReconcileArrayFallback`: absent or null is empty; any value other than an array is malformed. */
  private fun nullishArray(obj: JSONObject, key: String, path: String): JSONArray {
    if (!obj.has(key) || obj.isNull(key)) return JSONArray()
    return obj.opt(key) as? JSONArray ?: throw ReconcileParseException("$path is not an array")
  }

  /** A required string; absent, null and any other type are malformed. */
  private fun requiredString(obj: JSONObject, key: String, path: String): String =
    obj.opt(key) as? String ?: throw ReconcileParseException("$path is missing or not a string")

  /** An optional string (zod `.optional()`): absent is `null`; null or any other type is malformed. */
  private fun optionalString(obj: JSONObject, key: String, path: String): String? {
    if (!obj.has(key)) return null
    return obj.opt(key) as? String ?: throw ReconcileParseException("$path is not a string")
  }

  /** An optional number (zod `.optional()`): absent is `null`; null or any other type is malformed. */
  private fun optionalNumber(obj: JSONObject, key: String, path: String): Number? {
    if (!obj.has(key)) return null
    return obj.opt(key) as? Number ?: throw ReconcileParseException("$path is not a number")
  }

  /** An optional boolean (zod `.optional()`): absent is `null`; null or any other type is malformed. */
  private fun optionalBoolean(obj: JSONObject, key: String, path: String): Boolean? {
    if (!obj.has(key)) return null
    return obj.opt(key) as? Boolean ?: throw ReconcileParseException("$path is not a boolean")
  }

  /** An optional integer (zod `.int().optional()`): a fractional number is malformed too. */
  private fun optionalInteger(obj: JSONObject, key: String, path: String): Long? {
    val number = optionalNumber(obj, key, path) ?: return null
    if (number.toDouble() != Math.floor(number.toDouble())) {
      throw ReconcileParseException("$path is not an integer")
    }
    return number.toLong()
  }

  /** Every member of a `changed_fields` array must be a string (`z.array(z.string())`). */
  private fun parseStringArray(array: JSONArray, path: String): List<String> =
    (0 until array.length()).map { index ->
      array.opt(index) as? String ?: throw ReconcileParseException("$path[$index] is not a string")
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
  "episodes" to "episodes",
  "season" to "season",
)

private const val WIRE_MAPPER_LOG_TAG = "SyncEngineWireMapper"

object WireAnimeMapper {

  /**
   * Normalizes one bridge change for staging: normalizes `changed_fields` into the local
   * vocabulary (unknown wire names are DROPPED and logged, mirroring
   * `normalizeWireAnimeChangedFields`; an update left with no known field is rejected by the JS
   * drain, which never guesses the changed set) and maps the snapshot into the legacy shape. Throws
   * {@link ReconcileParseException} when a snapshot is present but lacks its required scalars
   * — same retryable-failure semantics as a failed zod parse of the whole response.
   */
  fun normalize(change: BridgeChangeEntry): NormalizedBridgeChange {
    val normalizedFields = change.changedFields.mapNotNull { LOCAL_FIELD_BY_WIRE_FIELD[it] }
    val rejectedFields = change.changedFields.filterNot { LOCAL_FIELD_BY_WIRE_FIELD.containsKey(it) }
    if (rejectedFields.isNotEmpty()) {
      Log.w(WIRE_MAPPER_LOG_TAG, "remote_change_rejected ${change.recordId}: unknown fields $rejectedFields")
    }
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
   * numeric string, or `{ "$$date": n }` object, else `null`), the legacy empty-string sentinel →
   * empty array for `days`/`genres`, and the local `genres` element type invariant (every member
   * must be a string, see [mapStringArrayOrEmpty]).
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
    // Sent only together with `folder`, so it is never a `changed_fields` name of its own.
    legacy.put("folderRelative", wire.opt("folderRelative") ?: JSONObject.NULL)
    legacy.put("estudios", wire.opt("studios") ?: JSONObject.NULL)
    legacy.put("origen", wire.opt("origin") ?: JSONObject.NULL)
    legacy.put("duracion", wire.opt("durationMinutes") ?: JSONObject.NULL)
    legacy.put("episodes", mapEpisodes(wire.opt("episodes")))
    legacy.put("season", mapSeason(wire.opt("season")))
    return legacy
  }

  /**
   * Maps the season candidacy, mirroring `AnimeSeasonSchema` with its `.catch(null)`: rebuilt with
   * the keys `seasonId, grade` (extra keys dropped), where `seasonId` is a non-empty string and
   * `grade` is present and either `null` or a whole number 1-6. An absent value (not a candidate),
   * `null` or a malformed one maps to `null` instead of failing the snapshot.
   */
  private fun mapSeason(value: Any?): Any {
    if (value !is JSONObject) return JSONObject.NULL
    val seasonId = value.opt("seasonId") as? String
    if (seasonId.isNullOrEmpty() || !value.has("grade")) return JSONObject.NULL
    val rawGrade = value.opt("grade")
    if (rawGrade == JSONObject.NULL) {
      return JSONObject().put("seasonId", seasonId).put("grade", JSONObject.NULL)
    }
    val grade = wholeNumberOrNull(rawGrade)
    if (grade == null || grade < 1 || grade > 6) return JSONObject.NULL
    return JSONObject().put("seasonId", seasonId).put("grade", grade)
  }

  /**
   * Maps the per-episode durations, mirroring `EpisodeLengthSchema` with its `.catch(null)`: every
   * entry is rebuilt with the keys `episode, minutes, long` (extra keys dropped), and an absent,
   * `null` or malformed value maps to `null` instead of failing the snapshot. Durations are display
   * data; rejecting the snapshot would block every other field of the anime with them.
   */
  private fun mapEpisodes(value: Any?): Any {
    if (value !is JSONArray) return JSONObject.NULL
    val mapped = JSONArray()
    for (index in 0 until value.length()) {
      val entry = value.opt(index) as? JSONObject ?: return JSONObject.NULL
      val episode = wholeNumberOrNull(entry.opt("episode"))
      val minutes = wholeNumberOrNull(entry.opt("minutes"))
      val long = entry.opt("long")
      if (episode == null || episode < 1 || minutes == null || minutes < 0 || long !is Boolean) {
        return JSONObject.NULL
      }
      mapped.put(JSONObject().put("episode", episode).put("minutes", minutes).put("long", long))
    }
    return mapped
  }

  /** A JSON number with no fractional part, as a [Long]; anything else (strings included) is null. */
  private fun wholeNumberOrNull(value: Any?): Long? {
    if (value !is Number) return null
    val asDouble = value.toDouble()
    // JSON cannot carry NaN or Infinity, so a fractional part is the only non-integer case left.
    if (asDouble != Math.floor(asDouble)) return null
    return asDouble.toLong()
  }

  /** A required string; absence throws (retryable parse failure), mirroring zod's required field. */
  private fun requireString(wire: JSONObject, key: String): String {
    val value = wire.opt(key)
    if (value !is String) {
      throw ReconcileParseException("snapshot.$key is required and must be a string")
    }
    return value
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

  /**
   * Maps genres, coercing the legacy empty-string sentinel to `[]` and enforcing the LOCAL domain
   * contract on every element (`genres: z.array(z.string())` in `AnimeSchema`): a member that is
   * not a string throws (retryable), so a snapshot the foreground drain would refuse can never be
   * staged and then committed as an anime. `opt` returns `JSONObject.NULL` for a JSON `null`
   * member, so a null element is rejected here exactly like a number or a nested array.
   */
  private fun mapStringArrayOrEmpty(value: Any?): Any {
    if (value == null || value == JSONObject.NULL) return JSONArray()
    if (value is String && value.isEmpty()) return JSONArray()
    if (value !is JSONArray) throw ReconcileParseException("snapshot.genres must be an array")
    for (index in 0 until value.length()) {
      if (value.opt(index) !is String) {
        throw ReconcileParseException("snapshot.genres[$index] must be a string")
      }
    }
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
      // `.opt("\$\$date")` (not `?: JSONObject.NULL`, T3 sync-core-test-assurance; proven
      // unreachable, removed): org.json never stores a raw Java `null` for a key -- a JSON
      // `null` value is stored as the `JSONObject.NULL` sentinel -- so once `has("\$\$date")`
      // is true, `.opt("\$\$date")` can only return that sentinel or the real value, never
      // Kotlin `null`. The elvis's right side could only run for a caller this function does
      // not have (its guarding `has()` check already forces the left side non-null).
      is JSONObject -> if (value.has("\$\$date")) value.opt("\$\$date") else JSONObject.NULL
      else -> JSONObject.NULL
    }
  }
}
