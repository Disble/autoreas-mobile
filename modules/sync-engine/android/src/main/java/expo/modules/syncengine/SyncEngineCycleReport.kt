package expo.modules.syncengine

import org.json.JSONArray
import org.json.JSONObject

/**
 * Bridge's closed `error_name` and `error_cause` pair for one native failure (schema
 * `SyncDiagnosticsCycleReport.previous_cycle`), with the fingerprint that groups an unrecognized
 * class.
 */
internal data class NativeCycleErrorClass(
  val errorName: String,
  val errorCause: String,
  val fingerprint: String?,
)

/** Everything one native failed cycle's `cycle_report` carries. */
internal data class NativeCycleReport(
  val cycleId: String,
  /** `foreground_service` or `background_task`: the diary's name of the native trigger. */
  val triggerSource: String,
  val startedAtMs: Long,
  val elapsedMs: Long,
  /** The Kotlin state the cycle was in when it failed ([CycleOutcome.stage]). */
  val stage: String,
  /** The thrown class's simple name or the engine's own failure name ([CycleOutcome.errorName]). */
  val errorName: String?,
  val pendingOpsCount: Long,
  val cursor: Long,
)

/** Transport classes that mean the bridge did not answer in time. */
private val TIMEOUT_ERRORS = setOf("SocketTimeoutException")

/** Transport classes that mean the bridge could not be reached at all. */
private val UNREACHABLE_ERRORS =
  setOf("ConnectException", "NoRouteToHostException", "UnknownHostException", "PortUnreachableException")

/** Local SQLite classes whose class alone names the cause, as the JS message patterns do. */
private val LOCAL_WRITE_CAUSES = mapOf(
  "SQLiteDatabaseLockedException" to "lock_contention",
  "SQLiteTableLockedException" to "lock_contention",
  "SQLiteFullException" to "disk_full",
  "SQLiteDiskIOException" to "io_error",
)

/**
 * Maps the Kotlin state a cycle failed in onto Bridge's `last_stage` vocabulary
 * (odd/tasks/mobile-report-kinds.md S2): `checked` -> `attempt_started`, `claimed` -> `claim_ops`,
 * `sent` -> `http`, `applied` -> `apply_write`. Closest values for the rest: `idle` (the runner
 * crashed before the cycle's first transition) -> `open`, `closed` -> `closed`. Any other state is
 * not a stage the engine fails in, so it is sent as `null` rather than guessed.
 */
internal fun nativeCycleReportStage(stage: String): String? = when (stage) {
  "idle" -> "open"
  "checked" -> "attempt_started"
  "claimed" -> "claim_ops"
  "sent" -> "http"
  "applied" -> "apply_write"
  "closed" -> "closed"
  else -> null
}

/**
 * Classifies a native failure by its class name only -- the message is never read and never sent
 * (S2). Timeouts and unreachable hosts are the bridge's; `ReconcileHttpError` keeps its name;
 * `ReconcileParseException` is a `SchemaValidationError`; every `SQLite*Exception` is a
 * `LocalWriteError`, with a cause when its class names one. Anything else is `unknown` / `unknown`
 * with an FNV-1a fingerprint of the class name, so unknown classes can still be told apart.
 */
internal fun classifyNativeCycleError(errorName: String?): NativeCycleErrorClass = when {
  errorName == null -> NativeCycleErrorClass("unknown", "unknown", null)
  errorName in TIMEOUT_ERRORS -> NativeCycleErrorClass("BridgeTimeoutError", "timeout", null)
  errorName in UNREACHABLE_ERRORS -> NativeCycleErrorClass("BridgeUnreachableError", "unreachable", null)
  errorName == "ReconcileHttpError" -> NativeCycleErrorClass("ReconcileHttpError", "unknown", null)
  errorName == "ReconcileParseException" -> NativeCycleErrorClass("SchemaValidationError", "unknown", null)
  errorName.startsWith("SQLite") && errorName.endsWith("Exception") ->
    NativeCycleErrorClass("LocalWriteError", LOCAL_WRITE_CAUSES[errorName] ?: "unknown", null)
  else -> NativeCycleErrorClass("unknown", "unknown", nativeErrorFingerprint(errorName))
}

/**
 * 32-bit FNV-1a over the UTF-16 code units of [value], as exactly 8 lowercase hex characters --
 * the shape Bridge's `error_fingerprint` pattern requires.
 */
internal fun nativeErrorFingerprint(value: String): String {
  var hash = FNV_OFFSET_BASIS
  value.forEach { char ->
    hash = hash xor char.code
    hash *= FNV_PRIME
  }
  return Integer.toHexString(hash).padStart(8, '0')
}

private const val FNV_OFFSET_BASIS = 0x811c9dc5.toInt()
private const val FNV_PRIME = 0x01000193

/**
 * Builds the `cycle_report` body (Bridge schema `SyncDiagnosticsCycleReport`) for one native FAILED
 * cycle, keys in the schema's wire order. The failure lives in `previous_cycle` under the cycle's
 * own id, which is also the top-level `cycle_id`; nothing is shed, so `degraded` is `null` and the
 * native engine keeps no event ring, so `recent_events` is `[]`. `app_state` is always
 * `background`, as Bridge documents for every headless sender.
 */
internal fun buildNativeCycleReport(report: NativeCycleReport): String {
  val error = classifyNativeCycleError(report.errorName)
  val previousCycle = JSONObject()
    .put("cycle_id", report.cycleId)
    .put("trigger_source", report.triggerSource)
    .put("outcome", "failed")
    .put("last_stage", nativeCycleReportStage(report.stage) ?: JSONObject.NULL)
    .put("started_at", report.startedAtMs)
    .put("elapsed_ms", report.elapsedMs.coerceAtLeast(0L))
    .put("error_name", error.errorName)
    .put("native_errcode_byte", JSONObject.NULL)
    .put("error_stage", JSONObject.NULL)
    .put("error_cause", error.errorCause)
    .put("error_fingerprint", error.fingerprint ?: JSONObject.NULL)
  val counters = JSONObject()
    .put("consecutive_unclosed_cycles", 0)
    .put("pending_ops_count", report.pendingOpsCount)
    .put("cursor", report.cursor)
  return JSONObject()
    .put("kind", "cycle_report")
    .put("cycle_id", report.cycleId)
    .put("degraded", JSONObject.NULL)
    .put("trigger_source", report.triggerSource)
    .put("app_state", "background")
    .put("previous_cycle", previousCycle)
    .put("counters", counters)
    .put("recent_events", JSONArray())
    .toString()
}
