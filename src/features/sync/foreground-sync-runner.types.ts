export interface CreateForegroundSyncRunnerParams {
  readonly intervalMs: number;
  readonly runCycle: () => Promise<void>;
}

export interface ForegroundSyncRunner {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly isRunning: () => boolean;
}
