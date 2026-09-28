package expo.modules.syncengine

import android.content.Context
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import androidx.work.multiprocess.RemoteCoroutineWorker
import expo.modules.foregroundsyncticker.SyncTickerOwnership

/**
 * `triggerSource` every floor attempt journals and projects; mirrors the JS floor's own
 * `BACKGROUND_SYNC_ENGINE_TRIGGER_SOURCE` and the `SyncRuntimeTriggerSource` member
 * `'background_task'` (`src/features/sync/sync-runtime-status.types.ts`).
 */
internal const val SYNC_FLOOR_TRIGGER_SOURCE = "background_task"

/**
 * How long [SyncFloorAttempt] waits for the attempt runner to settle before giving up on this run.
 * [ENGINE_BUDGET_MS] (30 s) is [SyncEngineRunner]'s own watchdog budget -- its callback always
 * fires within it by contract -- so this is a defensive margin over that guarantee for an
 * injected runner that does not honour it, not a second budget of its own. It stays far under
 * WorkManager's own ~10-minute stop limit, which is the limit that would otherwise strand the
 * floor.
 */
internal const val FLOOR_ATTEMPT_BUDGET_MS = ENGINE_BUDGET_MS + 10_000L

/**
 * Maps one floor tick's terminal state to the `ListenableWorker.Result` the floor has reported
 * since M2 -- the ONLY decision this adapter makes, and the reason [SyncFloorAttempt] can stay
 * free of `androidx.work` types.
 *
 * A skipped tick and a completed attempt are both completions (`success()`): the period owns the
 * next tick either way, and a tick that ran nothing must not be a failure. An attempt that never
 * settled and one whose runner threw are both `retry()` -- deliberately NOT `failure()`, which
 * would mark the periodic work FAILED and silently end the floor for good, and deliberately not
 * `success()`, which would report an outcome nobody observed.
 *
 * A top-level function on purpose: the worker is now an
 * `androidx.work.multiprocess.RemoteCoroutineWorker`, whose local entry point is the suspend
 * `doRemoteWork()` (the base class owns `startRemoteWork()` and declares `startWork()` `final`),
 * so this mapping must be testable without a worker instance.
 */
internal fun SyncFloorAttemptResult.toListenableWorkerResult(): ListenableWorker.Result = when (this) {
  SyncFloorAttemptResult.SkippedOwnedByTicker,
  SyncFloorAttemptResult.AttemptCompleted,
  -> ListenableWorker.Result.success()

  SyncFloorAttemptResult.AttemptUnsettled,
  SyncFloorAttemptResult.AttemptCrashed,
  -> ListenableWorker.Result.retry()
}

/**
 * The native periodic floor's worker (ODD native-background-sync-cutover M2): when the native
 * foreground-service ticker does NOT own the background, run ONE native sync attempt, project its
 * outcome into `sync_runtime_status` honestly, and complete exactly once.
 *
 * **This class is an adapter, on purpose, and that is its whole job.** The attempt itself --
 * ownership gate, one attempt through [SyncEngineRunner] with `requirePresence = true`, the
 * exactly-once settlement race, the bounded wait, the `CancellationException` propagation, the
 * status projection with [SYNC_FLOOR_TRIGGER_SOURCE], and the crash-safety around both injectable
 * seams -- lives in [SyncFloorAttempt], which documents every one of those behaviors and their
 * reasons. Here the tick is only: build the collaborator from the seams below, run it, and map
 * its [SyncFloorAttemptResult] with [toListenableWorkerResult]. Nothing is re-decided.
 *
 * **Why the behavior is not in this class.** The floor runs in a dedicated `:sync` Android process
 * as an `androidx.work.multiprocess.RemoteCoroutineWorker`, so Expo's vendored SQLite core and the
 * framework SQLite core never open `autoreas.db` from the same process. The base class makes
 * `startWork()` `final` and the remote entry point is the suspend `doRemoteWork()`, driven by the
 * process hosting the bound `RemoteWorkerService` that [SyncFloorScheduler] names in the request's
 * input data. The collaborator extraction keeps the attempt behavior covered across this
 * base-class swap.
 *
 * **No local in-process shortcut.** This adapter does NOT run the attempt itself, nor does it fall
 * back to a local `Worker` when the remote binding is unavailable: a local path here would execute
 * the attempt -- and open `autoreas.db` through the framework core -- in the CALLING process,
 * recreating the exact two-cores-in-one-process hazard this split removes. `doRemoteWork()` only
 * ever builds [SyncFloorAttempt] and runs it in whichever process the base class bound to.
 *
 * The seams below (`attemptRunner`, `runtimeStatusWriter`, `ownsBackgroundCheck`,
 * `attemptTimeoutMsForTest`) are `internal` and default to the real collaborators, exactly as
 * before the extraction and exactly like [SyncForegroundService]'s, so this module's own test
 * source set can drive the floor without a live ticker, a live database or the wire.
 */
class SyncFloorWorker(context: Context, params: WorkerParameters) : RemoteCoroutineWorker(context, params) {

  /** Swappable in tests; defaults to the real [SyncEngineRunner.runOnce]. */
  internal var attemptRunner: SyncAttemptRunner = { context, triggerSource, cycleId, startMs, requirePresence, onResult ->
    SyncEngineRunner.runOnce(context, triggerSource, cycleId, startMs, requirePresence, onResult)
  }

  /** Swappable in tests; defaults to the real [SyncEngineRuntimeStatus.record]. */
  internal var runtimeStatusWriter: (Context, String, Long, CycleOutcome, String) -> Unit =
    { context, cycleId, attemptedAtMs, outcome, triggerSource ->
      SyncEngineRuntimeStatus.record(context, cycleId, attemptedAtMs, outcome, triggerSource)
    }

  /** Swappable in tests; defaults to the real, ticker-owned [SyncTickerOwnership.ownsBackground]. */
  internal var ownsBackgroundCheck: (Context) -> Boolean = SyncTickerOwnership::ownsBackground

  /**
   * Test-only override for the wait bound (the shape [SyncEngineRunner.budgetMsOverrideForTest]
   * already uses), so a test can prove the no-settlement path without waiting out the real
   * margin. `null` (the default) leaves production behavior untouched.
   */
  internal var attemptTimeoutMsForTest: Long? = null

  override suspend fun doRemoteWork(): ListenableWorker.Result =
    SyncFloorAttempt(
      context = applicationContext,
      attemptRunner = attemptRunner,
      runtimeStatusWriter = runtimeStatusWriter,
      ownsBackgroundCheck = ownsBackgroundCheck,
      attemptTimeoutMsForTest = attemptTimeoutMsForTest,
    ).run().toListenableWorkerResult()
}
