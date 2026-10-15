/** Summarizes one pass over staged remote changes. */
export interface DrainPendingRemoteChangesResult {
  readonly applied: number;
  readonly dropped: number;
  readonly deferred: number;
  /** Updates rejected because no field in them is known to this build: nothing was written. */
  readonly rejected: number;
  readonly drainedCount: number;
}
