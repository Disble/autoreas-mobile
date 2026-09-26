package expo.modules.syncengine

import android.content.Context
import android.util.Log
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.Operation
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import expo.modules.foregroundsyncticker.SyncTickerOwnership
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
 * Unique work name the PRE-NATIVE floor registered its request under. The string is owned by
 * `expo-background-task`'s own `BackgroundTaskScheduler` (`private const val WORKER_IDENTIFIER`,
 * verified in the library source), and it is reproduced here because the cutover has to cancel that
 * request from Kotlin: an upgrading install still has it scheduled, and the retired JS unregister
 * was conditional on TaskManager metadata (`TaskManager.isTaskRegisteredAsync`) -- exactly the
 * condition a migrated install can no longer satisfy.
 */
internal const val LEGACY_EXPO_UNIQUE_WORK_NAME = "EXPO_BACKGROUND_WORKER"

/**
 * The floor's registration state, projected for the JS-facing status surface. The field names mirror
 * the `SyncRuntimeStatusSnapshot` vocabulary (`registrationStatus`, `isBackgroundTaskRegistered`)
 * the retired JS floor strategy already reported through, plus [ownsBackground] for the ticker gate
 * this floor itself applies.
 *
 * **Every field describes the NATIVE floor only.** `registrationStatus` and
 * `isBackgroundTaskRegistered` are read from [SYNC_FLOOR_UNIQUE_WORK_NAME] alone, so the leftover
 * pre-native [LEGACY_EXPO_UNIQUE_WORK_NAME] request can never make them say `registered`. A native
 * enqueue that is not confirmed reports `unregistered`: the legacy request may still be scheduled
 * beside it during this transitional work unit, and reporting that as a registered floor would mask
 * the loss of the native one instead of surfacing it.
 *
 * This type deliberately carries NO projection method: turning it into the promise payload is the
 * Expo adapter's job ([SyncEngineModule]), which the unit-test harness cannot exercise (INFRA, no
 * Kover gate). A mapper living here would be ungated, untestable code inside a gated class.
 */
data class SyncFloorStatus(
  val registrationStatus: String,
  val isBackgroundTaskRegistered: Boolean,
  val ownsBackground: Boolean,
)

/**
 * Registers, unregisters and reports the native periodic floor (ODD native-background-sync-cutover
 * M2, wired into the foreground runtime by M3). [register] and [unregister] are reached from JS
 * through `SyncEngineModule`'s `registerBackgroundSyncFloor`/`unregisterBackgroundSyncFloor`
 * methods, which the foreground runtime's floor strategy calls, and [status] backs the same
 * strategy's reported status. The retired `expo-background-task` floor is no longer registered from
 * JS -- [register] retires its [LEGACY_EXPO_UNIQUE_WORK_NAME] request -- and that floor's leftover
 * JS task/cycle files are deleted in the next M3 work unit.
 *
 * **Idempotence comes from the unique work name, not from a flag.** [register] uses
 * [WorkManager.enqueueUniquePeriodicWork] with [SYNC_FLOOR_UNIQUE_WORK_NAME], so calling it twice
 * leaves exactly ONE periodic request -- the property M3 needs when its registration effect runs
 * again on every app start and on every Fast Refresh. `UPDATE` (rather than `KEEP`) is deliberate:
 * a re-registration must be able to refresh the request's own definition (a future interval or
 * constraint change) instead of silently keeping a stale one, and with an unchanged definition
 * WorkManager keeps the existing schedule.
 *
 * **No constraints, deliberately.** A network constraint would skip attempts while offline, but
 * the attempt's own presence gate already bounds an unreachable bridge to a single probe inside
 * [SyncEngineRunner]'s budget with no local writes; adding a constraint would only widen the gap
 * between the platform's judgement of "reachable" and the bridge's, which is a product decision
 * this task does not make.
 *
 * **[status] blocks.** It resolves `WorkManager`'s `ListenableFuture` synchronously, so it belongs
 * on a background caller thread -- the Expo `AsyncFunction` thread it is called from, never the
 * main thread, which the module adapter already guarantees. **[register] and [unregister] block for
 * the same reason**, and [register] needs it: the pre-native floor must only be retired once this
 * floor's enqueue is CONFIRMED (see [register]).
 */
object SyncFloorScheduler {

  /** Work states that mean "the periodic request is scheduled and will still run". A
   * `cancelUniqueWork` leaves the WorkSpec row behind in `CANCELLED`, so an unchecked
   * "is the list non-empty" test would report a cancelled floor as registered. */
  private val SCHEDULED_STATES =
    setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)

  /**
   * Enqueues (or refreshes) the single periodic floor request for [SYNC_FLOOR_UNIQUE_WORK_NAME],
   * and -- ONLY once WorkManager confirms that enqueue -- cancels the pre-native floor's
   * [LEGACY_EXPO_UNIQUE_WORK_NAME] request.
   *
   * **Confirmation, not fire-and-forget.** `enqueueUniquePeriodicWork` returns an [Operation] and
   * does its work asynchronously, so returning before it settles would allow the order the cutover
   * must never produce: a FAILED enqueue followed by a legacy cancellation, leaving the device with
   * no floor at all. [confirmOperation] blocks on that result, and an unconfirmed enqueue returns
   * immediately -- an older, working floor always beats an unconfirmed new one.
   *
   * **What an unconfirmed enqueue reports.** The returned status is read from
   * [SYNC_FLOOR_UNIQUE_WORK_NAME] alone, so this call reports `unregistered` for the NATIVE floor
   * instead of fabricating a success. It deliberately does NOT report the still-scheduled
   * [LEGACY_EXPO_UNIQUE_WORK_NAME] request as a registered floor: that request belongs to the JS
   * callback the next M3 work unit deletes, and calling it the registered floor would hide the loss
   * of the native one -- the exact failure this cutover exists to prevent. The legacy request
   * therefore stays pending, visible as `unregistered`, until a later confirmed registration retires
   * it or [unregister] cancels both.
   *
   * @param enqueue Confirmation seam for the enqueue itself. The default performs the real
   *   unique-periodic enqueue and blocks on its result; the module's own test source set injects
   *   `false` to exercise the unconfirmed branch without a broken WorkManager.
   * @return the floor status AFTER this attempt, read from the real scheduled state -- so an
   *   unconfirmed enqueue reports what is actually scheduled (typically `unregistered`) instead of
   *   a fabricated success, and a caller can tell the two apart.
   */
  fun register(
    context: Context,
    enqueue: (WorkManager) -> Boolean = ::enqueueConfirmedFloorRequest,
  ): SyncFloorStatus {
    val workManager = WorkManager.getInstance(context)

    if (!enqueue(workManager)) {
      return status(context)
    }

    cancelLegacyExpoFloor(workManager)
    return status(context)
  }

  /**
   * Cancels BOTH the native floor request and the pre-native [LEGACY_EXPO_UNIQUE_WORK_NAME]
   * request (see [cancelLegacyExpoFloor] for why that second cancellation lives here). Safe to call
   * when neither was ever registered, and never throws: a failed cancellation is logged and the
   * resulting status is still resolved so the caller's disable path can report the truth.
   *
   * @return the floor status after both cancellations, i.e. normally `unregistered`.
   */
  fun unregister(context: Context): SyncFloorStatus {
    val workManager = WorkManager.getInstance(context)

    confirmOperation(
      workManager.cancelUniqueWork(SYNC_FLOOR_UNIQUE_WORK_NAME),
      "native floor cancellation",
    )
    cancelLegacyExpoFloor(workManager)
    return status(context)
  }

  /** Performs the real unique-periodic enqueue and reports whether WorkManager confirmed it. */
  private fun enqueueConfirmedFloorRequest(workManager: WorkManager): Boolean =
    confirmOperation(
      workManager.enqueueUniquePeriodicWork(
        SYNC_FLOOR_UNIQUE_WORK_NAME,
        ExistingPeriodicWorkPolicy.UPDATE,
        buildFloorWorkRequest(),
      ),
      "native floor enqueue",
    )

  /**
   * Cancels the pre-native floor's unique request. Kotlin owns this cleanup because the retired JS
   * unregister was conditional on TaskManager metadata: on an install that migrated, that lookup can
   * answer "not registered" while the WorkManager request is still scheduled, which would leave two
   * floors racing (harmless thanks to the lease and the ticker gate, but not what the cutover
   * promises). `cancelUniqueWork` needs only the name, so it cannot miss it that way -- and the name
   * is preserved after the `expo-background-task` dependency is removed in the next work unit.
   */
  private fun cancelLegacyExpoFloor(workManager: WorkManager) {
    confirmOperation(
      workManager.cancelUniqueWork(LEGACY_EXPO_UNIQUE_WORK_NAME),
      "legacy floor cancellation",
    )
  }

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

  /**
   * Reports whether the NATIVE floor is scheduled, and whether the ticker currently owns the
   * background. Read from [SYNC_FLOOR_UNIQUE_WORK_NAME] only: the pre-native
   * [LEGACY_EXPO_UNIQUE_WORK_NAME] request is deliberately not part of this projection, because a
   * floor this class does not own must never be reported as this class's own registration.
   */
  fun status(context: Context): SyncFloorStatus {
    val isRegistered = scheduledWorkInfos(context).any { it.state in SCHEDULED_STATES }

    return SyncFloorStatus(
      registrationStatus = if (isRegistered) "registered" else "unregistered",
      isBackgroundTaskRegistered = isRegistered,
      ownsBackground = SyncTickerOwnership.ownsBackground(context),
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
   */
  internal fun buildFloorWorkRequest(): PeriodicWorkRequest =
    PeriodicWorkRequestBuilder<SyncFloorWorker>(SYNC_FLOOR_INTERVAL_MINUTES, TimeUnit.MINUTES).build()

  private fun scheduledWorkInfos(context: Context): List<WorkInfo> =
    WorkManager.getInstance(context)
      .getWorkInfosForUniqueWork(SYNC_FLOOR_UNIQUE_WORK_NAME)
      .get()
}
