/** Outcome a `runWithConcurrency` worker reports for one item: keep scheduling, or halt. */
export type ConcurrencyWorkerOutcome = 'continue' | 'stop';

/** Per-item unit of work `runWithConcurrency` drives with bounded parallelism. */
export type ConcurrencyWorker<TItem> = (item: TItem) => Promise<ConcurrencyWorkerOutcome>;

/** Summary `runWithConcurrency` resolves with once every scheduled item has settled. */
export interface RunWithConcurrencyResult {
  /** True when a worker returned `'stop'` (or threw) before every item was scheduled. */
  readonly stopped: boolean;
}
