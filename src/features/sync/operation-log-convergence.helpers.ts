import type { SQLiteDatabase } from 'expo-sqlite';
import {
  countOperationLogBacklogRows,
  countRowsForStatus,
} from './operation-log-retention.helpers';
import { RECONCILE_BACKLOG_BATCH_LIMIT } from './reconcile.constants';
import type { OperationLogConvergence } from './operation-log-convergence.types';

/** Shapes the single-row result of the oldest-pending-row query. */
interface OperationLogOldestPendingRow {
  readonly oldest: number | null;
}

/** Reads the `created_at` of the oldest `pending`-or-`processing` row, or `null` when none exist. */
async function readOldestPendingCreatedAt(rawDb: SQLiteDatabase): Promise<number | null> {
  const row = await rawDb.getFirstAsync<OperationLogOldestPendingRow>(
    "SELECT MIN(created_at) AS oldest FROM operation_log WHERE status IN ('pending', 'processing')",
  );

  return row?.oldest ?? null;
}

/**
 * Computes the convergence projection over `operation_log`: terminal-failure counts, rows stuck
 * in `processing`, the oldest pending operation's age, and the true backlog depth with an
 * explicit continuation flag (spec: `sync-convergence-observability`). Every read composes the
 * exported `countRowsForStatus`/`countOperationLogBacklogRows` primitives or calls `getFirstAsync`
 * directly, so this function never touches `withLocalWrite` (design.md Decision 1) and can run
 * before retention pruning deletes the rows it counts.
 */
export async function readOperationLogConvergence(
  rawDb: SQLiteDatabase,
  now: number = Date.now(),
): Promise<OperationLogConvergence> {
  const [deadLetterCount, conflictExhaustedCount, stuckProcessingCount, pendingRowCount, oldestPendingCreatedAt] =
    await Promise.all([
      countRowsForStatus(rawDb, 'dead_letter'),
      countRowsForStatus(rawDb, 'conflict_exhausted'),
      countRowsForStatus(rawDb, 'processing'),
      countOperationLogBacklogRows(rawDb, ['pending', 'processing']),
      readOldestPendingCreatedAt(rawDb),
    ]);

  return {
    deadLetterCount,
    conflictExhaustedCount,
    stuckProcessingCount,
    oldestPendingAgeMs: oldestPendingCreatedAt === null ? null : now - oldestPendingCreatedAt,
    pendingRowCount,
    hasMore: pendingRowCount > RECONCILE_BACKLOG_BATCH_LIMIT,
  };
}
