import type { ForegroundSyncTicker } from './native-foreground-sync-ticker.types';

/** Defines the data contract for create foreground sync runner params. */
export interface CreateForegroundSyncRunnerParams {
  readonly ticker: ForegroundSyncTicker;
  readonly runCycle: () => Promise<void>;
  readonly onCycleError: (error: unknown) => void | Promise<void>;
}

/** Defines the data contract for foreground sync runner. */
export interface ForegroundSyncRunner {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly isRunning: () => boolean;
}
