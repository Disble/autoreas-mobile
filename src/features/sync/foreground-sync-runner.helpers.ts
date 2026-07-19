import type {
  CreateForegroundSyncRunnerParams,
  ForegroundSyncRunner,
} from './foreground-sync-runner.types';

/**
 * Creates a cancellable foreground-sync runner that owns the reconcile-cycle lifecycle.
 * The cadence itself comes from an injected `ForegroundSyncTicker` (native-driven, immune to JS
 * timer suspension) -- this runner only subscribes to ticks and reacts. Ticker start/stop lifecycle
 * is owned by the caller (e.g. the Notifee adapter), not by this runner, so the same ticker instance
 * can be reused across FGS register/unregister cycles independently of runner start/stop.
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
    } catch (error) {
      await params.onCycleError(error);
    }
  }

  return {
    start() {
      if (runningPromise) {
        return runningPromise;
      }

      unsubscribeTick = params.ticker.onTick(() => {
        void runCycleSafely();
      });

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
