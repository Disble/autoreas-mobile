import type { ForegroundSyncTicker } from './native-foreground-sync-ticker.types';
import type { SyncAttemptPolicy } from './attempt-policy.types';

/** Defines the data contract for create foreground sync runner params. */
export interface CreateForegroundSyncRunnerParams {
  readonly ticker: ForegroundSyncTicker;
  readonly runCycle: () => Promise<void>;
  readonly onCycleError: (error: unknown) => void | Promise<void>;
  /**
   * Optional T6 attempt policy. When provided, every tick consults it before running the cycle:
   * a refused tick (in-flight attempt, backoff window, or absent bridge) returns immediately
   * without touching `runCycle`, and an approved attempt reports its outcome back through
   * `recordSuccess` / `recordFailure`. When omitted, every tick runs the cycle unchanged.
   */
  readonly attemptPolicy?: SyncAttemptPolicy;
}

/** Defines the data contract for foreground sync runner. */
export interface ForegroundSyncRunner {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly isRunning: () => boolean;
}
