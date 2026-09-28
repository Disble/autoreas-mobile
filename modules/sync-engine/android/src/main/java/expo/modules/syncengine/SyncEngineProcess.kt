package expo.modules.syncengine

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Process

/**
 * Stable, non-sensitive error code the JS-facing `runOnce` promise is rejected with when the call
 * does not run in the app's MAIN process. It names the refusal, not the trigger or the caller, so
 * it is safe to surface: no SQL, connection value, path or user data is attached to it.
 */
internal const val SYNC_ENGINE_WRONG_PROCESS_ERROR_CODE = "ERR_SYNC_ENGINE_WRONG_PROCESS"

/**
 * Stable, non-sensitive refusal message paired with [SYNC_ENGINE_WRONG_PROCESS_ERROR_CODE]. Kept as
 * a constant (rather than built per call) so the promise rejection shape cannot drift between
 * callers, and so a test can pin it as the visible contract.
 */
internal const val SYNC_ENGINE_WRONG_PROCESS_MESSAGE =
  "Native sync runOnce is refused: it may only run in the app's main process."

/**
 * Decides whether THIS process may run a native app-database write, and reads the real process
 * name for that decision.
 *
 * **Why a process guard exists at all (ODD mobile-database-recovery T3 slice B2a).** Two
 * independently linked SQLite cores exist in this app: Expo's vendored `exsqlite3_*` (used by JS
 * through `expo-sqlite`) and the Android framework SQLite (used by [SyncEngineRunner] and
 * [SyncEngineRuntimeStatus]). Confirmed offline reproduction shows that two cores writing one
 * `autoreas.db` through separate WAL instances can persist `INSERT`+`COMMIT` and still lose rows,
 * with `quick_check`/`integrity_check` passing -- the structural hazard this whole work unit
 * removes. The only durable fix is to keep those cores in different processes.
 *
 * The native owner is being moved into the WorkManager remote worker's `:sync` process
 * (the `androidx.work:work-multiprocess` `RemoteCoroutineWorker` and its bound
 * `RemoteWorkerService`). [SyncEngineModule] is the one remaining entry point that opens
 * `autoreas.db` through the FRAMEWORK core in whatever process called it, and JS is exactly the
 * caller that may find itself outside the main process. Refusing there -- before touching the
 * runner or the database -- is the fail-closed half of the split: leaving it ungated would let a
 * second process re-open the app database with the second core and recreate the hazard this slice
 * exists to eliminate.
 *
 * **The decision is pure and total.** [isMainProcess] compares the trimmed process name against the
 * app package name and treats a `null`/blank name as "not main" on purpose: an unknown process is
 * refused rather than trusted, which is the safe direction for a guard whose failure mode is
 * database corruption. [currentProcessName] is the thin, side-effecting wrapper that reads the
 * real value; keeping the decision separate from the read is what lets the predicate be unit
 * tested without an Android runtime.
 *
 * **Follow-up (NOT implemented here).** Cross-process routing of a non-main `runOnce` call back to
 * the main process is deliberately out of scope for this slice; a refused call is reported, not
 * forwarded.
 */
internal object SyncEngineProcess {

  /**
   * Pure predicate: true only when [processName], normalized by trimming surrounding whitespace,
   * equals [packageName] exactly (the app's main process).
   *
   * A `null` or blank [processName] answers `false` -- "unknown is not the main process". The
   * comparison is exact after trimming: Android names additional processes `"<package>:<suffix>"`
   * (for example `"com.example.app:sync"`), which must NOT match the bare package name.
   */
  fun isMainProcess(processName: String?, packageName: String): Boolean {
    val normalized = processName?.trim()
    if (normalized.isNullOrEmpty()) {
      return false
    }
    return normalized == packageName
  }

  /**
   * Pure refusal projection used by [SyncEngineModule]: `null` when the call may proceed in this
   * process, or the stable, non-sensitive [SYNC_ENGINE_WRONG_PROCESS_ERROR_CODE] when it must be
   * refused. Kept here, beside [isMainProcess], so the refusal shape has exactly one definition and
   * one test seam instead of living inline in the un-unit-testable Expo adapter.
   */
  fun refusalCodeFor(processName: String?, packageName: String): String? =
    if (isMainProcess(processName, packageName)) {
      null
    } else {
      SYNC_ENGINE_WRONG_PROCESS_ERROR_CODE
    }

  /**
   * Reads the real process name for the current process, or `null` when it cannot be determined.
   *
   * API 28+ exposes [Application.getProcessName] directly. Below that, the running-processes list
   * is filtered by [Process.myPid]; the platform only returns this app's own processes to an app,
   * which is exactly the scope this guard needs. A `null` answer is [isMainProcess]'s "not main"
   * case and therefore a refusal, never an implicit allow.
   */
  fun currentProcessName(context: Context): String? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Application.getProcessName()
    } else {
      legacyProcessName(context)
    }

  @Suppress("DEPRECATION")
  private fun legacyProcessName(context: Context): String? {
    val activityManager =
      context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null
    val myPid = Process.myPid()
    return activityManager.runningAppProcesses?.firstOrNull { it.pid == myPid }?.processName
  }
}
