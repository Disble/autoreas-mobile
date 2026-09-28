package expo.modules.syncengine

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The floor's log tag, deliberately unchanged from the pre-extraction `SyncFloorWorker.kt`: the
 * tick it describes is still the native periodic floor, so on-device logcat filtering (and the
 * documented `Trace tag: SyncFloorWorker` / floor diagnostics greps in `odd/tasks/`) keeps
 * matching the same lines.
 */
private const val LOG_TAG = "SyncFloorWorker"

/**
 * Every distinguishable end state of one floor tick -- the complete set of outcomes [SyncFloorAttempt]
 * can report, so its caller only has to MAP this value, never re-decide it.
 *
 * The states mirror the branches the floor has reported since M2:
 *
 * - [SkippedOwnedByTicker]: the ticker owns the background, so no attempt ran and nothing was written.
 * - [AttemptCompleted]: exactly one attempt settled and its outcome was projected (a status-write
 *   failure is folded in here on purpose -- see [SyncFloorAttempt], which logs it and does not let
 *   it change the tick's reported outcome).
 * - [AttemptUnsettled]: the runner delivered no outcome within the attempt budget.
 * - [AttemptCrashed]: the runner threw before settling.
 *
 * Only [SkippedOwnedByTicker] and [AttemptCompleted] are completed ticks; the other two are the
 * retryable ones. `SyncFloorWorker` owns that mapping (`toListenableWorkerResult`), so this type
 * stays free of every `androidx.work` type and therefore survives the planned swap of the worker's
 * base class to `androidx.work.multiprocess.RemoteCoroutineWorker`.
 */
internal sealed interface SyncFloorAttemptResult {

  /** The tick did nothing: the native foreground-service ticker owns the background. */
  data object SkippedOwnedByTicker : SyncFloorAttemptResult

  /** One attempt settled and its outcome was projected into `sync_runtime_status`. */
  data object AttemptCompleted : SyncFloorAttemptResult

  /** No settlement arrived within the attempt budget; nothing was observed, so nothing was written. */
  data object AttemptUnsettled : SyncFloorAttemptResult

  /** The attempt runner threw before it settled; nothing was observed, so nothing was written. */
  data object AttemptCrashed : SyncFloorAttemptResult
}

/**
 * The native periodic floor's ATTEMPT (ODD native-background-sync-cutover M2): when the native
 * foreground-service ticker does NOT own the background, run ONE native sync attempt through
 * [SyncEngineRunner], project its outcome into `sync_runtime_status` honestly, complete exactly
 * once, and report which of those end states was reached.
 *
 * **Why this class exists, separate from [SyncFloorWorker].** The worker is being moved into a
 * dedicated `:sync` Android process as an `androidx.work.multiprocess.RemoteCoroutineWorker`, and
 * `RemoteCoroutineWorker.startWork()` is `final` with no local `doWork()` to drive, so
 * `TestListenableWorkerBuilder` can no longer execute this behavior. Keeping the attempt here --
 * a plain Kotlin collaborator with no `androidx.work` type in its surface -- keeps every behavior
 * below unit-testable through its own public seam, [run], and leaves the worker with the single
 * job of mapping [SyncFloorAttemptResult] to a `ListenableWorker.Result`.
 *
 * **Why a Worker and not the service.** ADR 008 gives Kotlin ownership of the background cycle;
 * [SyncForegroundService] only exists while the user's foreground sync mode is armed. Without a
 * second, non-resident trigger the app would deliver nothing in the FGS-off configuration the
 * delivery policy accepts, which is exactly the gap the JS `expo-background-task` floor covers
 * today. This attempt is that floor, natively: no JS callback runs, so there is no
 * `runJsBackgroundSyncCycle()` fallback to fall back to, and a headless wake needs no React
 * runtime at all.
 *
 * **The ownership gate is the ticker's own answer, not a guess.** [SyncTickerOwnership] reports
 * whether the ticker's own armed alarm exists -- across processes, which is what makes the gate
 * correct once this code runs in `:sync` -- the same fact the JS floor reads through
 * `createNativeForegroundSyncTicker().isRunning()` before it decides to no-op, so the two floors
 * share ONE definition of "the ticker owns the background". A skipped tick is a COMPLETED tick
 * ([SyncFloorAttemptResult.SkippedOwnedByTicker]) and writes nothing: it is not a failure, the
 * period owns the next attempt, and a dismissed/refused tick must stay as cheap as it was on the
 * JS path.
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
 * within its budget, but this class does not trust an injected runner to honour that: one
 * [AtomicBoolean] makes the FIRST settlement the attempt's outcome and turns every later
 * settlement into a no-op, so a duplicated callback can never double-write the status row. An
 * attempt that never settles (or whose runner throws) is bounded by [FLOOR_ATTEMPT_BUDGET_MS] and
 * reported as a retryable state ([SyncFloorAttemptResult.AttemptUnsettled] /
 * [SyncFloorAttemptResult.AttemptCrashed]) -- deliberately NOT a failure, which would mark the
 * periodic work FAILED and silently end the floor for good, and deliberately not a completed
 * state, which would report an outcome nobody observed.
 *
 * **Coexistence with the service is belt-and-braces.** [SyncEngineRunner] serializes every
 * attempt process-wide and [SyncCycleLease] refuses a second claimant, so even a tick that
 * overlaps the service (the ticker being armed and the service not actually running yet, say)
 * cannot produce two concurrent cycles; the ownership gate exists to avoid paying for the
 * attempt at all, not to make the engine safe.
 *
 * The seams are constructor parameters (defaulted by the caller, `SyncFloorWorker`, to the real
 * collaborators) so this class's own test suite can drive [run] without a live ticker, a live
 * database or the wire.
 */
internal class SyncFloorAttempt(
  /** The context every collaborator is called with; the worker passes its `applicationContext`. */
  private val context: Context,
  /** Swappable in tests; the worker defaults it to the real [SyncEngineRunner.runOnce]. */
  private val attemptRunner: SyncAttemptRunner,
  /** Swappable in tests; the worker defaults it to the real [SyncEngineRuntimeStatus.record]. */
  private val runtimeStatusWriter: (Context, String, Long, CycleOutcome, String) -> Unit,
  /** Swappable in tests; the worker defaults it to the real, ticker-owned [SyncTickerOwnership.ownsBackground]. */
  private val ownsBackgroundCheck: (Context) -> Boolean,
  /**
   * Override for the wait bound (the shape [SyncEngineRunner.budgetMsOverrideForTest] already
   * uses), so a test can prove the no-settlement path without waiting out the real margin. `null`
   * (the production value) leaves [FLOOR_ATTEMPT_BUDGET_MS] in force.
   */
  private val attemptTimeoutMsForTest: Long? = null,
) {

  /**
   * Runs this tick to its single terminal state: the ownership gate, then at most one attempt
   * through [attemptRunner], then the status projection of the outcome that actually settled.
   * Returns exactly one [SyncFloorAttemptResult]; throws [CancellationException] (and nothing
   * else) when the caller's coroutine is cancelled, so a stopped worker is never reported as a
   * fabricated outcome and never writes a status row nobody waited for.
   */
  suspend fun run(): SyncFloorAttemptResult {
    if (ownsBackgroundCheck(context)) {
      Log.i(LOG_TAG, "floor tick skipped: the native ticker owns the background")
      return SyncFloorAttemptResult.SkippedOwnedByTicker
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
      return SyncFloorAttemptResult.AttemptCrashed
    }

    if (outcome == null) {
      Log.w(
        LOG_TAG,
        "floor attempt delivered no outcome within ${attemptBudgetMs()}ms (cycleId=$cycleId)",
      )
      return SyncFloorAttemptResult.AttemptUnsettled
    }

    try {
      runtimeStatusWriter(context, cycleId, startMs, outcome, SYNC_FLOOR_TRIGGER_SOURCE)
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
    return SyncFloorAttemptResult.AttemptCompleted
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
        attemptRunner(context, SYNC_FLOOR_TRIGGER_SOURCE, cycleId, startMs, true) { outcome ->
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
