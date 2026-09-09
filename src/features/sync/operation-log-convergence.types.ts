/**
 * Defines the convergence projection over `operation_log`: terminal-failure counts, rows stuck
 * in `processing`, the oldest pending operation's age, and the true backlog depth with an
 * explicit continuation flag. Computed read-only, before retention pruning deletes the rows it
 * counts (design.md Decision 1).
 */
export interface OperationLogConvergence {
  readonly deadLetterCount: number;
  readonly conflictExhaustedCount: number;
  /** Rows still `processing` when this projection ran -- orphaned, not in flight. */
  readonly stuckProcessingCount: number;
  readonly oldestPendingAgeMs: number | null;
  /** TRUE row depth, never the `dedupeBy: 'anime_id'` batch size. */
  readonly pendingRowCount: number;
  readonly hasMore: boolean;
}
