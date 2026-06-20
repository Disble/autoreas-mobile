import type { SyncPendingOperationsResult } from './reconcile.types';

/**
 * Maximum number of pending operation-log rows the reconcile cycle reads in one batch.
 * This keeps memory usage bounded regardless of how large the backlog grows.
 */
export const RECONCILE_BACKLOG_BATCH_LIMIT = 200;

/**
 * Maximum number of pending operation-log ids surfaced by the live UI query.
 * This avoids materializing the entire backlog just to show a count badge.
 */
export const PENDING_OPERATIONS_LIVE_QUERY_LIMIT = 200;

export const syncStateByDatabase = new WeakMap<object, {
  inFlight: Promise<SyncPendingOperationsResult> | null;
  rerunRequested: boolean;
}>();
