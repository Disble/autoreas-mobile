package expo.modules.syncengine

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log

private const val LOG_TAG = "SyncEngineRuntimeStatus"

/** Row id of the singleton `sync_runtime_status` row; mirrors `SYNC_RUNTIME_STATUS_SINGLETON_ID`
 * (`src/features/sync/sync-runtime-status.constants.ts`). */
private const val RUNTIME_STATUS_ROW_ID = 1L

/**
 * `last_trigger_source` value this writer persists for every native-service attempt.
 * Deliberately NOT [SyncForegroundService.TRIGGER_SOURCE] (`"native_fgs_tick"`, the
 * journal/log-only identifier): `sync_runtime_status.last_trigger_source` is read by Settings
 * through the CLOSED `SyncRuntimeTriggerSource` union
 * (`src/features/sync/sync-runtime-status.types.ts`) and its
 * `BACKGROUND_SYNC_TRIGGER_SOURCE_LABELS` lookup (`settings-screen.constants.ts`'s
 * `Record<SyncRuntimeTriggerSource, string>`), neither of which has an entry for
 * `"native_fgs_tick"` -- persisting it verbatim would render Settings' "Último origen" tile as
 * "undefined". `"foreground_service"` is an EXISTING closed-vocabulary member, already labeled
 * ("Servicio foreground"), and -- since ODD native-foreground-sync-service T5 retired the
 * Notifee JS adapter that used to be its only writer -- this native writer is now the only thing
 * that ever persists it again, so reusing it is a clean fit, not a conflation of two live paths.
 */
private const val RUNTIME_STATUS_TRIGGER_SOURCE = "foreground_service"

/**
 * Native projection of one [SyncForegroundService] attempt's [CycleOutcome] into the app's
 * `sync_runtime_status` singleton row (ODD native-foreground-sync-service T6), so Settings stops
 * showing stale `last_attempt_at` / `last_success_at` / `last_trigger_source` now that the
 * retired JS FGS path (T5) no longer writes them at all.
 *
 * **Scope: the service caller only.** [record] is called from [SyncForegroundService]'s own
 * result callback (through its injectable [SyncForegroundService.runtimeStatusWriter] seam),
 * never from [SyncEngineRunner] or [SyncEngineModule]. The JS-driven `runOnce` path (background
 * task, manual sync) keeps writing whatever it already does today -- nothing, as this task found
 * -- untouched; widening this projection to every caller is a separate decision this task does
 * not make.
 *
 * **Mirrors the retired JS FGS path's own column shape**
 * (`src/features/sync/sync-runtime-status-patch.helpers.ts`'s `buildSyncAttemptSucceededPatch` /
 * `buildSyncAttemptFailedPatch`), not a from-scratch design:
 * - `not_applicable` (presence refused -- `BridgePresenceRefused` -- or the cycle's own
 *   no-config / lease-held-elsewhere fast paths) writes NOTHING here, exactly like the retired
 *   JS `attempt-policy.helpers.ts`'s `bridge_absent` decision (and the JS cycle's own no-config
 *   short-circuit) never touched `sync_runtime_status` either: a refused/no-op tick must stay
 *   exactly as cheap here as it always was.
 * - `closed` (success) sets `last_success_at`, `last_synced_count` and
 *   `last_backlog_read_count`; every OTHER outcome leaves those three columns alone -- a failed
 *   or abandoned attempt must never erase the last successful cycle's own numbers, exactly like
 *   the retired JS failed patch, which never included those keys.
 * - `failed` / `abandoned` (and any outcome string this object does not recognize, handled the
 *   same defensive way) clear what the JS failed patch always clears (`last_error_name` from
 *   [CycleOutcome.errorName], `consecutive_unclosed_cycles` -> 0, `is_cycle_active` -> false) and
 *   set `last_failure_message` from [CycleOutcome.errorName] / [CycleOutcome.stage] -- the native
 *   cycle carries no separate free-text message, only the error's class name (or `null`, for the
 *   watchdog's own `abandoned` outcome).
 * - `last_error_stage` / `last_native_errcode_byte` stay `null` always: the native cycle does not
 *   classify a transaction-phase or a parsed native errcode byte the way the JS cycle does
 *   (deferred; see [SyncEngineCycle]'s own class doc).
 *
 * **Never throws.** Opening the connection, the transaction and the write are all wrapped in one
 * `catch (Throwable)` that only logs: a status-write failure must never affect the attempt that
 * already completed, and -- critically -- must never keep [SyncForegroundService] from releasing
 * its wake lock or resetting its in-flight guard, both of which run right after this call in the
 * same result callback.
 *
 * **UPDATE-then-INSERT, not UPSERT.** `INSERT ... ON CONFLICT DO UPDATE` is what
 * [SyncCycleLease.claim] uses in production, but Robolectric 4.14.1's bundled SQLite rejects that
 * syntax outright (`near "ON": syntax error`; see [SyncEngineRunnerTest]'s class doc), so this
 * writer never uses it: an `UPDATE ... WHERE id = ?` (via [SQLiteDatabase.update]) runs first,
 * and only a genuine 0-rows-affected result -- the singleton row does not exist yet, a real, if
 * rare, case on a fresh install whose very first sync attempt runs through this service -- falls
 * back to a plain [SQLiteDatabase.insertOrThrow]. Both branches run inside one
 * [inImmediateTransaction], the engine's own short-transaction / `busy_timeout` convention (never
 * held across network -- this function never touches the network at all).
 */
object SyncEngineRuntimeStatus {

  /**
   * Records [outcome] for [cycleId] (started at [attemptedAtMs]) into `sync_runtime_status`.
   * Opens and closes its own connection to `autoreas.db` -- called at most once per attempt (the
   * service's own coalescing already keeps attempts from overlapping), so the extra open/close
   * over a long-lived connection is a small, once-per-tick cost, not a hot path.
   */
  fun record(context: Context, cycleId: String, attemptedAtMs: Long, outcome: CycleOutcome) {
    if (outcome.outcome == "not_applicable") {
      // Mirrors the retired JS attempt-policy gate and the JS cycle's own no-config short
      // circuit: neither ever wrote to sync_runtime_status for a refused/no-op attempt, so this
      // writer does not either (see the class doc).
      return
    }

    try {
      val db = openAppDatabase(context)
      try {
        inImmediateTransaction(db) {
          writeRow(db, cycleId, attemptedAtMs, outcome)
        }
      } finally {
        db.close()
      }
    } catch (error: Throwable) {
      Log.w(
        LOG_TAG,
        "status projection failed for cycle $cycleId (outcome=${outcome.outcome}); Settings may " +
          "keep showing a stale sync_runtime_status row",
        error,
      )
    }
  }

  private fun writeRow(
    db: SQLiteDatabase,
    cycleId: String,
    attemptedAtMs: Long,
    outcome: CycleOutcome,
  ) {
    val isSuccess = outcome.outcome == "closed"
    val values = ContentValues().apply {
      put("last_attempt_at", attemptedAtMs)
      putStringOrNull("last_failure_message", if (isSuccess) null else buildFailureMessage(outcome))
      put("last_trigger_source", RUNTIME_STATUS_TRIGGER_SOURCE)
      put("last_cycle_id", cycleId)
      put("last_cycle_stage", outcome.stage)
      put("last_cycle_stage_at", attemptedAtMs)
      putStringOrNull("last_error_name", if (isSuccess) null else outcome.errorName)
      putNull("last_error_stage")
      putNull("last_native_errcode_byte")
      put("consecutive_unclosed_cycles", 0)
      put("is_cycle_active", 0)
      // Deliberately absent otherwise: an UPDATE that never names these three columns leaves
      // them exactly as they were, and an INSERT that never names them falls back to the
      // schema's own DEFAULT (0 / null) -- both are the correct "not this attempt's business"
      // answer for a failed or abandoned attempt (see the class doc).
      if (isSuccess) {
        put("last_success_at", attemptedAtMs)
        put("last_synced_count", outcome.syncedCount)
        put("last_backlog_read_count", outcome.backlogReadCount)
      }
    }

    val rowsUpdated = db.update(
      "sync_runtime_status",
      values,
      "id = ?",
      arrayOf(RUNTIME_STATUS_ROW_ID.toString()),
    )

    if (rowsUpdated == 0) {
      values.put("id", RUNTIME_STATUS_ROW_ID)
      db.insertOrThrow("sync_runtime_status", null, values)
    }
  }

  /** [ContentValues] has no single overload Kotlin resolves for a nullable `String?`; this picks
   * [ContentValues.putNull] itself when [value] is `null` so a deliberate clear (e.g.
   * `last_error_name` on success) is never confused with "column left untouched" (which would
   * instead simply omit the `put` call entirely -- see [writeRow]'s success-only block). */
  private fun ContentValues.putStringOrNull(key: String, value: String?) {
    if (value == null) putNull(key) else put(key, value)
  }

  /**
   * The native cycle carries no free-text failure message, only [CycleOutcome.errorName] (a
   * class-name-shaped string, possibly `null` -- the watchdog's own `abandoned` outcome never
   * sets one) and [CycleOutcome.stage]. Builds a message in the same "<reason>: <ClassName>"
   * shape the native cycle's own journal transitions already use, without inventing a message
   * the native side never actually produced.
   */
  private fun buildFailureMessage(outcome: CycleOutcome): String {
    val errorSuffix = outcome.errorName?.let { ": $it" } ?: ""
    return "Native sync attempt ${outcome.outcome}$errorSuffix at stage '${outcome.stage}'"
  }
}
