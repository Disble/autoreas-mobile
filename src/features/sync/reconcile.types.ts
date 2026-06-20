/**
 * Describes the result of one bounded reconcile pass.
 * Callers use this to update observability and decide whether another batch is likely waiting.
 */
export interface SyncPendingOperationsResult {
  readonly syncedCount: number;
  readonly backlogReadCount: number;
  readonly hasMorePending: boolean;
}
