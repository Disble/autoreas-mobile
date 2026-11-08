package expo.modules.syncengine

import android.content.Context
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import expo.modules.foregroundsyncticker.SyncDiary
import expo.modules.foregroundsyncticker.syncDiaryFor
import java.io.File

private const val LOG_TAG = "SyncEngineAttemptDiary"

/** At most this many `cycle_report`s per `error_name` per hour (odd/tasks/mobile-report-kinds.md S2). */
internal const val NATIVE_CYCLE_REPORT_LIMIT_PER_HOUR = 3

/** Lock-wait budget of the read-only app database read behind each record. */
private const val APP_STATE_BUSY_TIMEOUT_MS = 250L

/** How one native attempt ended, as its caller (the service or the floor) observed it. */
internal sealed interface NativeAttemptEnd {
  /** The runner settled with [outcome]. */
  data class Settled(val outcome: CycleOutcome) : NativeAttemptEnd

  /** The floor did nothing: the ticker owns the background. */
  data object SkippedOwnedByTicker : NativeAttemptEnd

  /** The runner threw before it settled. */
  data object Crashed : NativeAttemptEnd

  /** No settlement arrived within the caller's wait. */
  data object Unsettled : NativeAttemptEnd
}

/** One native attempt to count, under the native [triggerSource] its caller ran it with. */
internal data class NativeAttemptRecord(
  val triggerSource: String,
  /** The attempt's id; `null` when the attempt never minted one (a skipped floor tick). */
  val cycleId: String?,
  val startMs: Long,
  val end: NativeAttemptEnd,
)

/** The record seam both callers hold, defaulting to [recordNativeSyncAttempt]. */
internal typealias NativeAttemptDiaryRecorder = (Context, NativeAttemptRecord) -> Unit

/** What the app database says about one attempt's report: the user's switch and the counters. */
internal data class NativeDiaryAppState(
  val isSyncTelemetryEnabled: Boolean,
  val pendingOpsCount: Long,
  val cursor: Long,
)

/** The diary's `trigger_source` for a native trigger; `null` for one the diary does not count. */
internal fun nativeDiaryTriggerSource(triggerSource: String): String? = when (triggerSource) {
  SyncForegroundService.TRIGGER_SOURCE -> "foreground_service"
  SYNC_FLOOR_TRIGGER_SOURCE -> "background_task"
  else -> null
}

/**
 * The diary's `outcome` for one native attempt (odd/tasks/mobile-report-kinds.md S3, L5):
 * `abandoned` counts as `unsettled`, and a `not_applicable` attempt counts only when its reason is
 * the bridge's absence or the schema; one with no config or a lease held elsewhere is not counted.
 */
internal fun nativeDiaryOutcome(end: NativeAttemptEnd): String? = when (end) {
  NativeAttemptEnd.SkippedOwnedByTicker -> "skipped_owned_by_ticker"
  NativeAttemptEnd.Crashed -> "crashed"
  NativeAttemptEnd.Unsettled -> "unsettled"
  is NativeAttemptEnd.Settled -> when (end.outcome.outcome) {
    "closed" -> "closed"
    "failed" -> "failed"
    "abandoned" -> "unsettled"
    "not_applicable" -> when (end.outcome.errorName) {
      "BridgePresenceRefused" -> "presence_refused"
      "SchemaNotReady" -> "schema_not_ready"
      else -> null
    }
    else -> null
  }
}

/**
 * Counts native attempts in the sync diary and reports native FAILED cycles as `cycle_report`
 * (odd/tasks/mobile-report-kinds.md S2, S3). Gated like the courier
 * ([SyncEngineDiagnosticsCourier.drain]): while the user's diagnostics switch is off, or when it
 * cannot be read, nothing is recorded. Never throws.
 *
 * [readAppState] answers the switch and, when asked, the `counters` a report carries.
 */
internal class SyncEngineAttemptDiary(
  private val diary: SyncDiary,
  private val readAppState: (includeCounters: Boolean) -> NativeDiaryAppState?,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  /** Counts [record] once and, for a failed cycle, enqueues its `cycle_report` within the limit. */
  fun record(record: NativeAttemptRecord) {
    try {
      val triggerSource = nativeDiaryTriggerSource(record.triggerSource) ?: return
      val outcome = nativeDiaryOutcome(record.end) ?: return
      val failed = (record.end as? NativeAttemptEnd.Settled)?.outcome?.takeIf { it.outcome == "failed" }
      val cycleId = record.cycleId?.takeIf { it.isNotEmpty() }
      val isReported = failed != null && cycleId != null
      val state = readAppState(isReported) ?: return
      if (!state.isSyncTelemetryEnabled) return

      val nowMs = clock()
      val durationMs = if (record.end == NativeAttemptEnd.SkippedOwnedByTicker) 0L else nowMs - record.startMs
      diary.recordAttempt(triggerSource, outcome, durationMs.coerceAtLeast(0L), nowMs)
      if (failed == null || cycleId == null) return

      val report = NativeCycleReport(
        cycleId = cycleId,
        triggerSource = triggerSource,
        startedAtMs = record.startMs,
        elapsedMs = nowMs - record.startMs,
        stage = failed.stage,
        errorName = failed.errorName,
        pendingOpsCount = state.pendingOpsCount,
        cursor = state.cursor,
      )
      diary.enqueueLimitedReport(
        limitKey = "cycle_report:${classifyNativeCycleError(failed.errorName).errorName}",
        limitPerHour = NATIVE_CYCLE_REPORT_LIMIT_PER_HOUR,
        observationId = cycleId,
        payloadJson = buildNativeCycleReport(report),
        nowMs = nowMs,
      )
    } catch (error: Throwable) {
      Log.w(LOG_TAG, "attempt diary failed; nothing recorded", error)
    }
  }
}

/**
 * Reads the user's diagnostics switch from the app database through a READ-ONLY connection, plus
 * the pending operation count and the changelog cursor when [includeCounters]. `null` -- nothing
 * may be recorded -- when the file is missing or unreadable. A store with no `bridge_config` row
 * reads as enabled, as the JS switch does (absence is not a choice). A counter that cannot be read
 * is sent as `0`.
 */
internal fun readNativeDiaryAppState(appDatabaseFile: File, includeCounters: Boolean): NativeDiaryAppState? {
  if (!appDatabaseFile.exists()) return null
  return try {
    SQLiteDatabase.openDatabase(appDatabaseFile.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
      database.compileStatement("PRAGMA busy_timeout = $APP_STATE_BUSY_TIMEOUT_MS").use { it.execute() }
      val config = readBridgeConfig(database)
      val isEnabled = config?.isSyncTelemetryEnabled ?: true
      if (!includeCounters || !isEnabled) return@use NativeDiaryAppState(isEnabled, 0L, 0L)
      NativeDiaryAppState(
        isSyncTelemetryEnabled = true,
        pendingOpsCount = countPendingOperations(database),
        cursor = config?.lastChangelogId?.coerceAtLeast(0L) ?: 0L,
      )
    }
  } catch (error: Exception) {
    Log.w(LOG_TAG, "app database unreadable; the attempt is not recorded", error)
    null
  }
}

/** `operation_log` rows still waiting to be sent; `0` when the table cannot be read. */
private fun countPendingOperations(database: SQLiteDatabase): Long =
  try {
    DatabaseUtils.longForQuery(database, "SELECT COUNT(*) FROM operation_log WHERE status = 'pending'", null)
  } catch (error: Exception) {
    Log.w(LOG_TAG, "operation_log unreadable; pending_ops_count sent as 0", error)
    0L
  }

/**
 * The production recorder: the app's diary, gated on the app database beside it. Never throws, so
 * the attempt it describes keeps its result whatever the diary does.
 */
internal fun recordNativeSyncAttempt(context: Context, record: NativeAttemptRecord) {
  try {
    val appDatabaseFile = resolveAppDatabaseFile(context)
    SyncEngineAttemptDiary(syncDiaryFor(context), { includeCounters ->
      readNativeDiaryAppState(appDatabaseFile, includeCounters)
    }).record(record)
  } catch (error: Throwable) {
    Log.w(LOG_TAG, "attempt diary unavailable; nothing recorded", error)
  }
}
