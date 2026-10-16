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
  /**
   * Epoch-ms liveness floor for per-key claims (ADR 009 R-13). When set, every anime with ANY
   * row whose `claimed_at` is above this floor is left out entirely, before the dedup ranks
   * rows: excluding only the claimed row would let a newer row of the same anime rank first.
   * Only honoured together with `dedupeBy: 'anime_id'`.
   */
  readonly skipKeysClaimedAfter?: number;
}

/**
 * Defines the retention rule for `synced` operation-log rows: TTL first, then max-count.
 */
export interface OperationLogRetentionRule {
  readonly ttlDays: number;
  readonly maxCount: number;
}

/**
 * Defines the retention policy used for pruning. Only `synced` rows are pruned; given-up rows
 * are unresolved keys and are never pruned (ADR 009 R-16b).
 */
export interface OperationLogRetentionPolicy {
  readonly synced: OperationLogRetentionRule;
  readonly now: () => number;
}

/**
 * Defines the observable result returned after pruning `synced` operation-log rows.
 */
export interface OperationLogPruneResult {
  readonly deletedSyncedCount: number;
}

/**
 * Defines the aggregate count row returned by lightweight operation-log count queries.
 */
export interface OperationLogCountRow {
  readonly count: number;
}
