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

/**
 * Authentication failure, never a message rejection (ADR 009 R-5, 2026-10-25 amendment).
 * Fails the attempt without isolation; held anime edits return to `pending` for the next trigger.
 */
export const RECONCILE_UNAUTHORIZED_STATUS = 401;

