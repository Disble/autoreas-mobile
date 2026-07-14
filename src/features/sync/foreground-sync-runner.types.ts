/** Defines the data contract for create foreground sync runner params. */
export interface CreateForegroundSyncRunnerParams {
  readonly intervalMs: number;
  readonly runCycle: () => Promise<void>;
}

/** Defines the data contract for foreground sync runner. */
export interface ForegroundSyncRunner {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly isRunning: () => boolean;
}
