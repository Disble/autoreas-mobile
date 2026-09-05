/**
 * Names the operation-log statuses addressed by bounded backlog reads.
 *
 * `conflict_exhausted` (design.md Decision 6) is a THIRD terminal status, distinct from
 * `dead_letter`: it means an operation lost an optimistic-concurrency race the same non-advancing
 * way `CONFLICT_ATTEMPT_CAP` times in a row, never that the bridge rejected the request outright.
 * Folding it into `dead_letter` would erase that distinction for anyone reading the queue later.
 */
export type OperationLogBacklogStatus =
  | 'pending'
  | 'processing'
  | 'synced'
  | 'dead_letter'
  | 'conflict_exhausted';

/**
 * Names the stable sort mode used by operation-log backlog queries.
 */
export type OperationLogBacklogOrder = 'oldest_first';

/**
 * Names the terminal operation-log statuses eligible for retention pruning.
 */
export type OperationLogTerminalStatus = 'synced' | 'dead_letter' | 'conflict_exhausted';

/**
 * Defines one bounded operation-log backlog read request.
 *
 * `limit` bounds ROWS when `dedupeBy` is absent (today's byte-identical query), but bounds
 * DISTINCT ANIMES when `dedupeBy: 'anime_id'` is set -- a single anime with many queued
 * operations then contributes only its oldest row toward the same numeric budget.
 */
export interface OperationLogQueryParams {
  readonly status: readonly OperationLogBacklogStatus[];
  readonly limit: number;
  readonly orderBy: OperationLogBacklogOrder;
  /**
   * Opt-in per-anime dedup: at most one row per `anime_id` (the oldest by `created_at`/`id`)
   * survives into the result. Absent means today's flat query, unchanged. See
   * `readOperationLogBacklog`'s JSDoc for the SQL shape and design.md Decision 9 for why the
   * dedup runs BEFORE `LIMIT` rather than after.
   */
  readonly dedupeBy?: 'anime_id';
}

/**
 * Defines one retention rule for a terminal operation-log status.
 */
export interface OperationLogRetentionRule {
  readonly status: OperationLogTerminalStatus;
  readonly ttlDays: number;
  readonly maxCount: number;
}

/**
 * Defines the full terminal-status retention policy used for pruning.
 */
export interface OperationLogRetentionPolicy {
  readonly synced: OperationLogRetentionRule;
  readonly deadLetter: OperationLogRetentionRule;
  readonly conflictExhausted: OperationLogRetentionRule;
  readonly now: () => number;
}

/**
 * Defines the observable result returned after pruning terminal operation-log rows.
 */
export interface OperationLogPruneResult {
  readonly prunedCount: number;
  readonly deletedSyncedCount: number;
  readonly deletedDeadLetterCount: number;
  readonly deletedConflictExhaustedCount: number;
}

/**
 * Defines the aggregate count row returned by lightweight operation-log count queries.
 */
export interface OperationLogCountRow {
  readonly count: number;
}
