/** Terminal answer one background task run gives its host. */
export type BackgroundTaskOutcome = 'success' | 'failed';

/** One background task run: the cycle to execute and the budget it must settle within. */
export interface ResolveBackgroundTaskOutcomeParams {
  readonly runCycle: () => Promise<unknown>;
  readonly timeoutMs?: number;
}
