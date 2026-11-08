package expo.modules.foregroundsyncticker

import java.io.File

/**
 * The sync diary's closed vocabularies and limits, copied from the Bridge contract
 * (`SyncDiagnosticsHourlySummary`, `SyncDiagnosticsRuntimeTransition`) and from
 * odd/tasks/mobile-report-kinds.md S3-S5. A value off these lists is rejected here, before it is
 * stored, because the Bridge strict-decodes and would refuse the whole body for one bad field.
 */

/** Every `trigger_source` an hourly count may name (S3). `local_mutation_write` is not one. */
val SYNC_DIARY_TRIGGER_SOURCES: Set<String> = setOf(
  "foreground_service",
  "background_task",
  "bootstrap",
  "manual",
  "app_active",
  "network_regained",
  "local_mutation",
  "ws_sync_required",
)

/** Every `outcome` an hourly count may name (S3). */
val SYNC_DIARY_OUTCOMES: Set<String> = setOf(
  "closed",
  "failed",
  "presence_refused",
  "schema_not_ready",
  "skipped_owned_by_ticker",
  "unsettled",
  "crashed",
)

/** The two processes a death or a transition may name. */
val SYNC_DIARY_PROCESS_NAMES: Set<String> = setOf("main", "sync")

/** The 14 agreed `subject` / `transition` pairs (S4); any other combination is refused. */
val SYNC_DIARY_TRANSITIONS: Map<String, Set<String>> = mapOf(
  "service" to setOf("started", "stopped", "refused"),
  "tick_alarm" to setOf("armed", "cancelled"),
  "floor" to setOf("armed", "cancelled", "skipped", "started"),
  "process" to setOf("started", "died"),
  "boot" to setOf("started"),
  "network" to setOf("started", "stopped"),
)

/** Shape of a recorded reason, a death's or a transition's. */
private val SYNC_DIARY_REASON_PATTERN = Regex("^[a-z0-9_]{1,40}$")

/** Shape of `app_version` on a transition body. */
private val SYNC_DIARY_APP_VERSION_PATTERN = Regex("^[0-9A-Za-z._+-]{1,32}$")

/** The `app_version` sent when the build's own version name does not fit the wire pattern. */
const val SYNC_DIARY_UNKNOWN_APP_VERSION = "unknown"

/** New-kind rows stop when the outbox holds this many rows, keeping 40 of 100 for `episode_action` (S5). */
const val SYNC_DIARY_OUTBOX_RESERVE_ROWS = 60L

/** At most this many new-kind rows are inserted per UTC day (S5, owner approval 2026-11-07). */
const val SYNC_DIARY_DAILY_REPORT_LIMIT = 50L

/** Bridge cap on `counts[]` items in one summary. */
const val SYNC_DIARY_MAX_COUNT_ITEMS = 64

/** Bridge cap on `process_deaths[]` items in one summary. */
const val SYNC_DIARY_MAX_DEATH_ITEMS = 16

/** Bridge cap on any one `count` and on `dropped_count`. */
const val SYNC_DIARY_MAX_COUNT = 100_000L

/** Bridge cap on `max_duration_ms`. */
const val SYNC_DIARY_MAX_DURATION_MS = 3_600_000L

/** Length of the hour an hourly summary covers. */
const val SYNC_DIARY_HOUR_MS = 3_600_000L

/** Length of the UTC day the daily limit counts in. */
const val SYNC_DIARY_DAY_MS = 86_400_000L

/** Lock-wait budget for one diary transaction; mirrors `SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS`. */
const val SYNC_DIARY_BUSY_TIMEOUT_MS = 250L

/** Name of the JS-created telemetry database the diary writes into. */
const val SYNC_DIARY_TELEMETRY_DATABASE_NAME = "autoreas-telemetry.db"

/** Subdirectory expo-sqlite stores database files in, relative to the app's `filesDir`. */
private const val SYNC_DIARY_SQLITE_SUBDIRECTORY = "SQLite"

/** True when [reason] fits the wire pattern for a recorded reason. */
fun isSyncDiaryReason(reason: String): Boolean = SYNC_DIARY_REASON_PATTERN.matches(reason)

/**
 * True when one transition may be recorded: an agreed pair, a known process, and `process` +
 * `died` only from `sync` (deaths of `main` are counted in the summary instead).
 */
fun isSyncDiaryTransition(processName: String, subject: String, transition: String): Boolean {
  if (processName !in SYNC_DIARY_PROCESS_NAMES) return false
  if (SYNC_DIARY_TRANSITIONS[subject]?.contains(transition) != true) return false
  return !(subject == "process" && transition == "died" && processName != "sync")
}

/** The build's version name when it fits the wire pattern, otherwise [SYNC_DIARY_UNKNOWN_APP_VERSION]. */
fun sanitizeSyncDiaryAppVersion(versionName: String?): String =
  versionName?.takeIf { SYNC_DIARY_APP_VERSION_PATTERN.matches(it) } ?: SYNC_DIARY_UNKNOWN_APP_VERSION

/** Start of the hour holding [atMs]. */
fun syncDiaryHourStart(atMs: Long): Long = Math.floorDiv(atMs, SYNC_DIARY_HOUR_MS) * SYNC_DIARY_HOUR_MS

/** Start of the UTC day holding [atMs]. */
fun syncDiaryDayStart(atMs: Long): Long = Math.floorDiv(atMs, SYNC_DIARY_DAY_MS) * SYNC_DIARY_DAY_MS

/**
 * The telemetry database as the sibling of the app database (`filesDir/SQLite/`), where
 * expo-sqlite creates both; the same file `resolveTelemetryDatabaseFile` in `sync-engine` opens.
 */
fun resolveSyncDiaryTelemetryFile(filesDir: File): File =
  File(File(filesDir, SYNC_DIARY_SQLITE_SUBDIRECTORY), SYNC_DIARY_TELEMETRY_DATABASE_NAME)
