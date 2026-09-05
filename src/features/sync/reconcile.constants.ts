import type { SyncPendingOperationsResult } from './reconcile.types';

/**
 * Maximum number of pending operation-log entries the reconcile cycle reads in one batch.
 * Bounds DISTINCT ANIMES, not rows, because the backlog read dedupes per anime (design.md
 * Decision 9): a queue with many duplicate ops for one anime still only contributes its oldest
 * row toward this same numeric budget. This keeps memory usage bounded regardless of how large
 * the backlog grows.
 */
export const RECONCILE_BACKLOG_BATCH_LIMIT = 200;

/**
 * Maximum number of pending operation-log ids surfaced by the live UI query.
 * This avoids materializing the entire backlog just to show a count badge.
 */
export const PENDING_OPERATIONS_LIVE_QUERY_LIMIT = 200;

/** Provides the shared sync state by database value. */

export const syncStateByDatabase = new WeakMap<object, {
  inFlight: Promise<SyncPendingOperationsResult> | null;
  rerunRequested: boolean;
}>();
