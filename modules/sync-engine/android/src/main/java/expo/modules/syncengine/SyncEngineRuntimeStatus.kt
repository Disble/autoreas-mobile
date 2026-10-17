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
 * Native projection of one [SyncForegroundService] or [SyncFloorWorker] attempt's [CycleOutcome]
 * into the app's `sync_runtime_status` singleton row, so the reachability evidence and the device
 * verification script see native attempts too (ODD native-foreground-sync-service T6).
 *
 * **Only columns something reads.** It writes `last_attempt_at`, `last_cycle_id`,
 * `last_cycle_stage` and `last_error_name` for every recorded attempt, and `last_success_at` only
 * when the cycle `closed`: a failed or abandoned attempt never erases the last success. The JS
 * status facade reads the two instants (ADR 009 R-9); `scripts/lib/device-db-checks.mjs` reads the
 * cycle id, stage and error class (convergent-sync T18).
 * - `not_applicable` (presence refused, no config, lease held elsewhere) writes NOTHING: a
 *   refused or no-op tick stays as cheap as it always was.
 * - `last_error_name` is [CycleOutcome.errorName] for a failed or abandoned attempt and `null`
 *   on success.
 *
 * **Never throws.** Opening the connection, the transaction and the write are all wrapped in one
 * `catch (Throwable)` that only logs: a status-write failure must never affect the attempt that
 * already completed, and must never keep [SyncForegroundService] from releasing its wake lock or
 * resetting its in-flight guard, both of which run right after this call in the same callback.
 *
 * **UPDATE-then-INSERT, not UPSERT.** Robolectric 4.14.1's bundled SQLite rejects
 * `INSERT ... ON CONFLICT DO UPDATE` (`near "ON": syntax error`; see [SyncEngineRunnerTest]'s
 * class doc), so an `UPDATE ... WHERE id = ?` runs first, and only a genuine 0-rows-affected
 * result -- the singleton row does not exist yet on a fresh install -- falls back to a plain
 * [SQLiteDatabase.insertOrThrow]. Both branches run inside one [inImmediateTransaction], never
 * held across network.
 */
object SyncEngineRuntimeStatus {

  /**
   * Records [outcome] for [cycleId] (started at [attemptedAtMs]) into `sync_runtime_status`.
   * Opens and closes its own
   * connection to `autoreas.db` -- called at most once per attempt (each caller's own coalescing
   * already keeps attempts from overlapping), so the extra open/close over a long-lived connection
   * is a small, once-per-tick cost, not a hot path.
   *
   * **Readiness gate (ODD mobile-database-recovery T3 tail).** The connection is opened only when
   * [probeAppDatabaseReadiness] reports [AppDatabaseReadiness.Ready], so this writer never creates
   * the file and never writes status into a database the foreground has not durably prepared. A
   * not-ready database is a quiet skip, consistent with the never-throws contract below.
   */
  fun record(
    context: Context,
    cycleId: String,
    attemptedAtMs: Long,
    outcome: CycleOutcome,
  ) {
    if (outcome.outcome == "not_applicable") {
      // Mirrors the retired JS attempt-policy gate and the JS cycle's own no-config short
      // circuit: neither ever wrote to sync_runtime_status for a refused/no-op attempt, so this
      // writer does not either (see the class doc).
      return
    }

    // Readiness gate (ODD mobile-database-recovery T3 tail): never create `autoreas.db` and
    // never write to one the foreground has not durably stamped ready. The check runs BEFORE
    // [openAppDatabase], whose `openOrCreateDatabase` would otherwise create the file (and, on a
    // stamp older than the expected one, write status into a schema the foreground is still
    // preparing). A not-ready database is a quiet skip, not an error: this writer's contract is
    // that it never throws.
    if (probeAppDatabaseReadiness(context) != AppDatabaseReadiness.Ready) {
      Log.w(
        LOG_TAG,
        "status projection skipped for cycle $cycleId: app database not ready",
      )
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
      put("last_cycle_id", cycleId)
      put("last_cycle_stage", outcome.stage)
      putStringOrNull("last_error_name", if (isSuccess) null else outcome.errorName)
      // Deliberately absent otherwise: an UPDATE that never names `last_success_at` leaves it as
      // it was, and an INSERT falls back to NULL -- the correct answer for a failed or abandoned
      // attempt (see the class doc).
      if (isSuccess) {
        put("last_success_at", attemptedAtMs)
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
}
