package expo.modules.syncengine

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import expo.modules.foregroundsyncticker.SyncTickerOwnership
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

private const val LOG_TAG = "SyncFloorWorker"

/**
 * `triggerSource` every floor attempt journals and projects; mirrors the JS floor's own
 * `BACKGROUND_SYNC_ENGINE_TRIGGER_SOURCE` and the `SyncRuntimeTriggerSource` member
 * `'background_task'` (`src/features/sync/sync-runtime-status.types.ts`).
 */
internal const val SYNC_FLOOR_TRIGGER_SOURCE = "background_task"

/**
 * How long the worker waits for the attempt runner to settle before giving up on this run.
 * [ENGINE_BUDGET_MS] (30 s) is [SyncEngineRunner]'s own watchdog budget -- its callback always
 * fires within it by contract -- so this is a defensive margin over that guarantee for an
 * injected runner that does not honour it, not a second budget of its own. It stays far under
 * WorkManager's own ~10-minute stop limit, which is the limit that would otherwise strand the
 * floor.
 */
internal const val FLOOR_ATTEMPT_BUDGET_MS = ENGINE_BUDGET_MS + 10_000L

/**
 * The native periodic floor's worker (ODD native-background-sync-cutover M2): when the native
 * foreground-service ticker does NOT own the background, run ONE native sync attempt through
 * [SyncEngineRunner], project its outcome into `sync_runtime_status` honestly, and complete
 * exactly once.
 *
 * **Why a Worker and not the service.** ADR 008 gives Kotlin ownership of the background cycle;
 * [SyncForegroundService] only exists while the user's foreground sync mode is armed. Without a
 * second, non-resident trigger the app would deliver nothing in the FGS-off configuration the
 * delivery policy accepts, which is exactly the gap the JS `expo-background-task` floor covers
 * today. This worker is that floor, natively: no JS callback runs, so there is no
 * `runJsBackgroundSyncCycle()` fallback to fall back to, and a headless wake needs no React
 * runtime at all.
 *
 * **The ownership gate is the ticker's own answer, not a guess.** [SyncTickerOwnership] reports
 * the ticker's persisted ticking state -- the same fact the JS floor reads through
 * `createNativeForegroundSyncTicker().isRunning()` before it decides to no-op -- so the two floors
 * share ONE definition of "the ticker owns the background". A skipped tick completes as
 * `Result.success()` and writes nothing: it is not a failure, the period owns the next attempt,
 * and a dismissed/refused tick must stay as cheap as it was on the JS path.
 *
 * **The presence gate and the status projection are the service caller's, reused.** The attempt
 * runs with `requirePresence = true` ([SyncEngineRunner] probes `/api/status` inside its own
 * budget before it claims anything) because, like the service, this caller has no JS attempt
 * policy in front of it. The projection is [SyncEngineRuntimeStatus], the same writer the service
 * uses, called with [SYNC_FLOOR_TRIGGER_SOURCE] so `last_trigger_source` names the trigger that
 * actually ran instead of borrowing the service's `foreground_service` -- the value the closed
 * `SyncRuntimeTriggerSource` vocabulary already has for this path.
 *
 * **Exactly-once completion.** [SyncEngineRunner] guarantees its callback fires exactly once
 * within its budget, but this worker does not trust an injected runner to honour that: one
 * [AtomicBoolean] makes the FIRST settlement the attempt's outcome and turns every later
 * settlement into a no-op, so a duplicated callback can never double-write the status row. An
 * attempt that never settles (or whose runner throws) is bounded by [FLOOR_ATTEMPT_BUDGET_MS] and
 * reported as `Result.retry()` -- deliberately NOT `Result.failure()`, which would mark the
 * periodic work FAILED and silently end the floor for good, and deliberately not `success()`,
 * which would report an outcome nobody observed.
 *
 * **Coexistence with the service is belt-and-braces.** [SyncEngineRunner] serializes every
 * attempt process-wide and [SyncCycleLease] refuses a second claimant, so even a tick that
 * overlaps the service (the ticker being armed and the service not actually running yet, say)
 * cannot produce two concurrent cycles; the ownership gate exists to avoid paying for the
 * attempt at all, not to make the engine safe.
 *
 * The seams below (`attemptRunner`, `runtimeStatusWriter`, `ownsBackgroundCheck`) are `internal`
 * and default to the real collaborators, exactly like [SyncForegroundService]'s, so the module's
 * own test source set can drive `doWork()` without a live ticker, a live database or the wire.
 */
class SyncFloorWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

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

  override suspend fun doWork(): ListenableWorker.Result {
    if (ownsBackgroundCheck(applicationContext)) {
      Log.i(LOG_TAG, "floor tick skipped: the native ticker owns the background")
      return ListenableWorker.Result.success()
    }

    val cycleId = UUID.randomUUID().toString()
    val startMs = System.currentTimeMillis()
    Log.i(LOG_TAG, "floor tick starting attempt (cycleId=$cycleId)")

    val outcome = try {
      runAttempt(cycleId, startMs)
    } catch (cancellation: CancellationException) {
      // Work stopped: propagate, so WorkManager sees a cancelled worker instead of a fabricated
      // outcome -- and never record a status row for an attempt nobody waited for.
      throw cancellation
    } catch (error: Throwable) {
      Log.w(LOG_TAG, "floor attempt crashed before an outcome (cycleId=$cycleId)", error)
      return ListenableWorker.Result.retry()
    }

    if (outcome == null) {
      Log.w(
        LOG_TAG,
        "floor attempt delivered no outcome within ${attemptBudgetMs()}ms (cycleId=$cycleId)",
      )
      return ListenableWorker.Result.retry()
    }

    try {
      runtimeStatusWriter(applicationContext, cycleId, startMs, outcome, SYNC_FLOOR_TRIGGER_SOURCE)
    } catch (error: Throwable) {
      // SyncEngineRuntimeStatus.record never throws by contract, but this seam is injectable (a
      // test fake, or a future caller that does not honour that contract), so a status-write
      // failure must never turn a completed attempt into a retried one.
      Log.w(LOG_TAG, "status projection crashed (cycleId=$cycleId)", error)
    }

    Log.i(
      LOG_TAG,
      "floor attempt finished outcome='${outcome.outcome}' stage='${outcome.stage}' " +
        "(cycleId=$cycleId)",
    )
    return ListenableWorker.Result.success()
  }

  /**
   * Runs one attempt on the injected runner and returns its terminal outcome, or `null` when the
   * runner did not settle within [attemptBudgetMs]. The budget is enforced HERE (not by trusting
   * the runner) with [withTimeoutOrNull], whose cancellation of this coroutine makes a later
   * settlement a no-op rather than a second completion.
   */
  private suspend fun runAttempt(cycleId: String, startMs: Long): CycleOutcome? {
    val settled = AtomicBoolean(false)
    return withTimeoutOrNull(attemptBudgetMs()) {
      suspendCancellableCoroutine { continuation ->
        attemptRunner(applicationContext, SYNC_FLOOR_TRIGGER_SOURCE, cycleId, startMs, true) { outcome ->
          if (settled.compareAndSet(false, true)) {
            // `onCancellation` is deliberately null: the attempt is already over, so there is no
            // cleanup to run if this coroutine was cancelled (a timeout) between the CAS and here.
            continuation.resume(outcome, null)
          }
        }
      }
    }
  }

  private fun attemptBudgetMs(): Long = attemptTimeoutMsForTest ?: FLOOR_ATTEMPT_BUDGET_MS
}
