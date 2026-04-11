import type {
  CreateForegroundSyncRunnerParams,
  ForegroundSyncRunner,
} from './foreground-sync-runner.types';

/**
 * Creates a cancellable foreground-sync runner that owns the periodic reconcile loop.
 * This keeps the Notifee adapter focused on native service wiring while the runner controls cadence and shutdown.
 */
export function createForegroundSyncRunner(
  params: CreateForegroundSyncRunnerParams,
): ForegroundSyncRunner {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let runningPromise: Promise<void> | null = null;
  let resolveStopPromise: (() => void) | null = null;

  async function runCycleSafely() {
    try {
      await params.runCycle();
    } catch {
      // The next scheduled tick should still run; runtime observability is handled inside the sync cycle.
    }
  }

  return {
    start() {
      if (runningPromise) {
        return runningPromise;
      }

      runningPromise = (async () => {
        await runCycleSafely();

        intervalId = setInterval(() => {
          void runCycleSafely();
        }, params.intervalMs);

        await new Promise<void>((resolve) => {
          resolveStopPromise = resolve;
        });
      })().finally(() => {
        if (intervalId) {
          clearInterval(intervalId);
        }

        intervalId = null;
        runningPromise = null;
        resolveStopPromise = null;
      });

      return runningPromise;
    },

    async stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      resolveStopPromise?.();

      await runningPromise;
    },

    isRunning() {
      return runningPromise !== null;
    },
  };
}
