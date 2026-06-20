/**
 * Names the operation-log statuses addressed by bounded backlog reads.
 */
export type OperationLogBacklogStatus = 'pending' | 'processing' | 'synced' | 'dead_letter';

/**
 * Names the stable sort mode used by operation-log backlog queries.
 */
export type OperationLogBacklogOrder = 'oldest_first';

/**
 * Names the terminal operation-log statuses eligible for retention pruning.
 */
export type OperationLogTerminalStatus = 'synced' | 'dead_letter';

/**
 * Defines one bounded operation-log backlog read request.
 */
export interface OperationLogQueryParams {
  readonly status: readonly OperationLogBacklogStatus[];
  readonly limit: number;
  readonly orderBy: OperationLogBacklogOrder;
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
  readonly now: () => number;
}

/**
 * Defines the observable result returned after pruning terminal operation-log rows.
 */
export interface OperationLogPruneResult {
  readonly prunedCount: number;
  readonly deletedSyncedCount: number;
  readonly deletedDeadLetterCount: number;
}

/**
 * Defines the aggregate count row returned by lightweight operation-log count queries.
 */
export interface OperationLogCountRow {
  readonly count: number;
}
