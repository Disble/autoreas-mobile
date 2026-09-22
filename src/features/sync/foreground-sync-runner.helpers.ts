import type { CreateForegroundSyncRunnerParams, ForegroundSyncRunner } from './foreground-sync-runner.types';

/**
 * Creates a cancellable foreground-sync runner that owns the reconcile-cycle lifecycle.
 * The cadence itself comes from an injected `ForegroundSyncTicker` (alarm-driven, immune to CPU
 * suspension) -- this runner only subscribes to ticks and reacts. Ticker start/stop lifecycle
 * is owned by the caller (e.g. the Notifee adapter), not by this runner, so the same ticker
 * instance can be reused across FGS register/unregister cycles independently of runner start/stop.
 *
 * The tick callback returns the cycle's promise so the ticker can scope the native per-cycle wake
 * lock to the cycle's lifetime; `runCycleSafely` never rejects (failures route to `onCycleError`),
 * but if `onCycleError` itself throws the rejection still settles the promise and releases the lock.
 *
 * With an `attemptPolicy` (T6), every tick consults the policy first: a refused tick (in-flight
 * attempt, backoff window, or absent bridge) returns a promise that settles immediately -- the
 * wake lock is released at once and no cycle, write, or radio work happens -- so a no-op attempt
 * costs only the probe budget (1500 ms) instead of the measured 10 s full-timeout failure.
 */
export function createForegroundSyncRunner(
  params: CreateForegroundSyncRunnerParams,
): ForegroundSyncRunner {
  let runningPromise: Promise<void> | null = null;
  let resolveStopPromise: (() => void) | null = null;
  let unsubscribeTick: (() => void) | null = null;

  async function runCycleSafely() {
    try {
      await params.runCycle();
      params.attemptPolicy?.recordSuccess();
    } catch (error) {
      // The probe already proved the bridge present before this cycle was approved, so a cycle
      // failure never advances the backoff ladder (per-operation rejection is dead_letter's
      // business); it only clears the policy's in-flight guard.
      params.attemptPolicy?.recordFailure('cycle_failed');
      await params.onCycleError(error);
    }
  }

  /**
   * One tick, from the ticker's point of view. Always returns a promise: either the cycle's
   * (wake lock scoped to the cycle) or one that settles immediately for a skipped tick, so the
   * native ticker releases the per-cycle wake lock at once.
   */
  async function handleTick(): Promise<void> {
    if (!params.attemptPolicy) {
      await runCycleSafely();
      return;
    }

    const decision = await params.attemptPolicy.shouldAttemptTick();

    if (!decision.shouldAttempt) {
      // Skipped tick: settle immediately. The returned promise resolves without awaiting any
      // cycle, so the ticker's per-cycle wake lock is released right away.
      return;
    }

    await runCycleSafely();
  }

  return {
    start() {
      if (runningPromise) {
        return runningPromise;
      }

      unsubscribeTick = params.ticker.onTick(() => handleTick());

      runningPromise = new Promise<void>((resolve) => {
        resolveStopPromise = resolve;
      }).finally(() => {
        unsubscribeTick?.();
        unsubscribeTick = null;
        runningPromise = null;
        resolveStopPromise = null;
      });

      return runningPromise;
    },

    async stop() {
      resolveStopPromise?.();

      await runningPromise;
    },

    isRunning() {
      return runningPromise !== null;
    },
  };
}
