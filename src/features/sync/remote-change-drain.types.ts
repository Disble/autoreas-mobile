/** Summarizes one pass over staged remote changes. */
export interface DrainPendingRemoteChangesResult {
  readonly applied: number;
  readonly dropped: number;
  readonly deferred: number;
  readonly drainedCount: number;
}
