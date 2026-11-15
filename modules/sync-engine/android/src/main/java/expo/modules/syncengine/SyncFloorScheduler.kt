package expo.modules.syncengine

import android.content.Context
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.Operation
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.multiprocess.RemoteListenableWorker
import androidx.work.multiprocess.RemoteWorkerService
import androidx.work.workDataOf
import expo.modules.foregroundsyncticker.SyncDiaryRuntime
import java.util.concurrent.TimeUnit

/** Log tag for the floor's own scheduler diagnostics. */
private const val LOG_TAG = "SyncFloorScheduler"

/** Unique work name of the native periodic floor; a stable string so a later registration always
 * addresses the SAME request instead of stacking a second one. */
internal const val SYNC_FLOOR_UNIQUE_WORK_NAME = "autoreas-native-sync-floor"

/** The floor's period, in minutes. 15 is WorkManager's own minimum for periodic work, so this is
 * the shortest floor the platform can actually deliver. */
internal const val SYNC_FLOOR_INTERVAL_MINUTES = 15L

/**
 * The floor's registration state, projected for the JS-facing status surface. The field names mirror
 * the `SyncRuntimeStatusSnapshot` vocabulary (`registrationStatus`, `isBackgroundTaskRegistered`).
 * A native enqueue that is not confirmed reports `unregistered` instead of a fabricated success.
 *
 * This type deliberately carries NO projection method: turning it into the promise payload is the
 * Expo adapter's job ([SyncEngineModule]), which the unit-test harness cannot exercise (INFRA, no
 * Kover gate). A mapper living here would be ungated, untestable code inside a gated class.
 */
data class SyncFloorStatus(
  val registrationStatus: String,
  val isBackgroundTaskRegistered: Boolean,
)

/**
 * Registers, unregisters and reports the native periodic floor. [register] and [unregister] are
 * reached from JS through `SyncEngineModule`'s `registerBackgroundSyncFloor` /
 * `unregisterBackgroundSyncFloor`, which the foreground runtime's floor strategy calls, and
 * [status] backs the same strategy's reported status.
 *
 * **Idempotence comes from the unique work name, not from a flag.** [register] uses
 * [WorkManager.enqueueUniquePeriodicWork] with [SYNC_FLOOR_UNIQUE_WORK_NAME], so calling it on
 * every app start leaves exactly ONE periodic request. `UPDATE` (rather than `KEEP`) lets a
 * re-registration refresh the request's own definition; with an unchanged definition WorkManager
 * keeps the existing schedule.
 *
 * **No constraints, deliberately.** The attempt's own presence gate already bounds an unreachable
 * bridge to a single probe inside [SyncEngineRunner]'s budget with no local writes.
 *
 * **[register], [unregister] and [status] block** on WorkManager's futures, so they belong on the
 * Expo `AsyncFunction` thread they are called from, never the main thread.
 */
object SyncFloorScheduler {

  /** Work states that mean "the periodic request is scheduled and will still run". A
   * `cancelUniqueWork` leaves the WorkSpec row behind in `CANCELLED`, so an unchecked
   * "is the list non-empty" test would report a cancelled floor as registered. */
  private val SCHEDULED_STATES =
    setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)

  /**
   * Enqueues (or refreshes) the single periodic floor request for [SYNC_FLOOR_UNIQUE_WORK_NAME]
   * and blocks until WorkManager confirms it.
   *
   * @param enqueue Confirmation seam for the enqueue itself. The default performs the real
   *   unique-periodic enqueue and blocks on its result; the module's own test source set injects
   *   `false` to exercise the unconfirmed branch without a broken WorkManager.
   * @return the floor status AFTER this attempt, read from the real scheduled state, so an
   *   unconfirmed enqueue reports what is actually scheduled (typically `unregistered`).
   */
  fun register(
    context: Context,
    enqueue: (WorkManager) -> Boolean = { workManager ->
      enqueueConfirmedFloorRequest(context, workManager)
    },
  ): SyncFloorStatus {
    val wasRegistered = readIsRegistered(context)
    enqueue(WorkManager.getInstance(context))
    return status(context).also { result -> reportRegistrationChange(context, wasRegistered, result) }
  }

  /**
   * Cancels the native floor request. Safe to call when it was never registered, and never throws:
   * a failed cancellation is logged and the resulting status is still resolved so the caller's
   * disable path can report the truth.
   *
   * @return the floor status after the cancellation, i.e. normally `unregistered`.
   */
  fun unregister(context: Context): SyncFloorStatus {
    val wasRegistered = readIsRegistered(context)
    confirmOperation(
      WorkManager.getInstance(context).cancelUniqueWork(SYNC_FLOOR_UNIQUE_WORK_NAME),
      "native floor cancellation",
    )
    return status(context).also { result -> reportRegistrationChange(context, wasRegistered, result) }
  }

  /** Whether the native floor is scheduled before a change, or `null` when it cannot be read. */
  private fun readIsRegistered(context: Context): Boolean? =
    try {
      scheduledWorkInfos(context).any { it.state in SCHEDULED_STATES }
    } catch (error: Throwable) {
      Log.w(LOG_TAG, "floor registration unreadable before the change", error)
      null
    }

  /**
   * Reports `floor` + `armed` or `cancelled` to the sync diary only when the registration really
   * changed (odd/tasks/mobile-report-kinds.md S4): a refresh of a scheduled floor, or a cancel of
   * one that never existed, reports nothing, and neither does an unreadable starting state.
   */
  private fun reportRegistrationChange(context: Context, wasRegistered: Boolean?, result: SyncFloorStatus) {
    if (wasRegistered == null || wasRegistered == result.isBackgroundTaskRegistered) return
    SyncDiaryRuntime.recordTransition(context, "floor", if (result.isBackgroundTaskRegistered) "armed" else "cancelled")
  }

  /**
   * Performs the real unique-periodic enqueue and reports whether WorkManager confirmed it. Takes
   * [context] because the request must name the app package (`context.packageName`) so the remote
   * worker service -- which lives in the SAME app, in its own process -- can be resolved.
   */
  private fun enqueueConfirmedFloorRequest(context: Context, workManager: WorkManager): Boolean =
    confirmOperation(
      workManager.enqueueUniquePeriodicWork(
        SYNC_FLOOR_UNIQUE_WORK_NAME,
        ExistingPeriodicWorkPolicy.UPDATE,
        buildFloorWorkRequest(context),
      ),
      "native floor enqueue",
    )

  /**
   * Blocks until [operation] reports its terminal result, and answers whether that result was a
   * confirmed success. Everything else -- a failed operation, an interrupted wait, or a throwable
   * from the WorkManager future itself -- answers `false` and is logged, because an unconfirmed
   * WorkManager operation must never be readable as a successful one. Blocking is only safe on the
   * Expo `AsyncFunction` thread the module calls this from, never the main thread.
   */
  private fun confirmOperation(operation: Operation, action: String): Boolean =
    try {
      operation.result.get()
      true
    } catch (interrupted: InterruptedException) {
      Thread.currentThread().interrupt()
      Log.w(LOG_TAG, "$action was interrupted before it could be confirmed", interrupted)
      false
    } catch (error: Throwable) {
      Log.w(LOG_TAG, "$action failed", error)
      false
    }

  /** Reports whether the native floor is scheduled, read from [SYNC_FLOOR_UNIQUE_WORK_NAME]. */
  fun status(context: Context): SyncFloorStatus {
    val isRegistered = scheduledWorkInfos(context).any { it.state in SCHEDULED_STATES }

    return SyncFloorStatus(
      registrationStatus = if (isRegistered) "registered" else "unregistered",
      isBackgroundTaskRegistered = isRegistered,
    )
  }

  /**
   * Builds the exact request [register] enqueues: one [SyncFloorWorker] every
   * [SYNC_FLOOR_INTERVAL_MINUTES] minutes, with no initial delay and no explicit flex interval.
   *
   * **The first run does NOT wait a full interval.** This KDoc used to claim it did, "exactly like
   * the JS floor's `minimumInterval`"; device observation on 2026-09-25 (tablet `R52T30686RV`)
   * falsified that claim -- with no initial delay set, the first floor attempt ran about 30 s after
   * registration, while later attempts ran 15 min apart. WorkManager places the first execution of
   * a periodic request inside the first period rather than at its end, and that placement is its
   * own to decide; nothing here schedules an initial tick either way. The foreground runtime
   * already syncs on mount and on app-resume, so the early first attempt is an extra run, never a
   * gap in coverage.
   *
   * **The remote-worker arguments are what move the tick out of this process.** The request carries
   * [RemoteListenableWorker.ARGUMENT_PACKAGE_NAME] (this app's package, so WorkManager can resolve
   * the bound service inside the same app) and [RemoteListenableWorker.ARGUMENT_CLASS_NAME] (the
   * `androidx.work.multiprocess.RemoteWorkerService` the companion manifest slice declares with
   * `android:process=":sync"`). WorkManager hands those to the process hosting that service and
   * drives [SyncFloorWorker.doRemoteWork] there, so the floor's framework SQLite connection never
   * shares a process with Expo's SQLite core. Without both keys the remote worker cannot bind and
   * the tick would not run where the split requires it.
   */
  internal fun buildFloorWorkRequest(context: Context): PeriodicWorkRequest =
    PeriodicWorkRequestBuilder<SyncFloorWorker>(SYNC_FLOOR_INTERVAL_MINUTES, TimeUnit.MINUTES)
      .setInputData(
        workDataOf(
          RemoteListenableWorker.ARGUMENT_PACKAGE_NAME to context.packageName,
          RemoteListenableWorker.ARGUMENT_CLASS_NAME to RemoteWorkerService::class.java.name,
        ),
      )
      .build()

  private fun scheduledWorkInfos(context: Context): List<WorkInfo> =
    WorkManager.getInstance(context)
      .getWorkInfosForUniqueWork(SYNC_FLOOR_UNIQUE_WORK_NAME)
      .get()
}
