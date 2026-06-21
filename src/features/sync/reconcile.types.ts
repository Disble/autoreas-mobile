/**
 * Selects where a reconcile pass writes its pulled `bridge_changes`:
 * - `deferred` -> applies directly to `animes` via the merge boundary inside
 *   `withDeferredWrite` on the shared reactive connection (foreground callers: the manual
 *   reconcile mutation, bootstrap reconcile, WS-triggered sync).
 * - `staged` -> never touches `animes`; inserts into `pending_remote_changes` instead, for
 *   callers running on the isolated, non-reactive background connection (the headless sync
 *   cycle). A foreground drain hook later applies staged rows via the same merge boundary.
 */
export type ReconcileApplyMode = 'deferred' | 'staged';

/**
 * Describes the result of one bounded reconcile pass.
 * Callers use this to update observability and decide whether another batch is likely waiting.
 */
export interface SyncPendingOperationsResult {
  readonly syncedCount: number;
  readonly backlogReadCount: number;
  readonly hasMorePending: boolean;
}
