import type { SQLiteDatabase } from 'expo-sqlite';
import {
  DEFAULT_OPERATION_LOG_RETENTION_POLICY,
  OPERATION_LOG_RETENTION_DAY_IN_MS,
} from './operation-log-retention.constants';
import type {
  OperationLogCountRow,
  OperationLogPruneResult,
  OperationLogQueryParams,
  OperationLogRetentionPolicy,
} from './operation-log-retention.types';
import type { OperationLogRow } from '../../infrastructure/db/schema';

function buildStatusPlaceholders(statusCount: number) {
  return Array.from({ length: statusCount }, () => '?').join(', ');
}

function buildRetentionCutoffTimestamp(now: number, ttlDays: number) {
  return now - ttlDays * OPERATION_LOG_RETENTION_DAY_IN_MS;
}

async function countRowsForStatus(rawDb: SQLiteDatabase, status: string) {
  const row = await rawDb.getFirstAsync<OperationLogCountRow>(
    'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
    status,
  );

  return Number(row?.count ?? 0);
}

async function pruneRowsByTtl(
  rawDb: SQLiteDatabase,
  status: string,
  cutoffTimestamp: number,
) {
  const result = await rawDb.runAsync(
    [
      'DELETE FROM operation_log',
      'WHERE id IN (',
      '  SELECT id FROM operation_log',
      '  WHERE status = ? AND created_at < ?',
      '  ORDER BY created_at ASC, id ASC',
      ')',
    ].join(' '),
    status,
    cutoffTimestamp,
  );

  return result.changes;
}

async function pruneRowsByMaxCount(
  rawDb: SQLiteDatabase,
  status: string,
  maxCount: number,
) {
  const currentCount = await countRowsForStatus(rawDb, status);
  const overflowCount = Math.max(0, currentCount - maxCount);

  if (overflowCount === 0) {
    return 0;
  }

  const result = await rawDb.runAsync(
    [
      'DELETE FROM operation_log',
      'WHERE id IN (',
      '  SELECT id FROM operation_log',
      '  WHERE status = ?',
      '  ORDER BY created_at ASC, id ASC',
      '  LIMIT ?',
      ')',
    ].join(' '),
    status,
    overflowCount,
  );

  return result.changes;
}

/**
 * Reads a bounded, stable operation-log backlog without materializing the entire queue.
 * The query always orders by age so future reconcile batching can continue incrementally.
 */
export async function readOperationLogBacklog(
  rawDb: SQLiteDatabase,
  params: OperationLogQueryParams,
): Promise<OperationLogRow[]> {
  if (params.status.length === 0 || params.limit <= 0) {
    return [];
  }

  const statuses = [...params.status];
  const query = [
    'SELECT',
    '  id,',
    '  anime_id AS animeId,',
    '  operation,',
    '  payload,',
    '  status,',
    '  created_at AS createdAt',
    'FROM operation_log',
    `WHERE status IN (${buildStatusPlaceholders(statuses.length)})`,
    'ORDER BY created_at ASC, id ASC',
    'LIMIT ?',
  ].join(' ');

  return rawDb.getAllAsync<OperationLogRow>(query, ...statuses, params.limit);
}

/**
 * Counts pending operation-log rows for lightweight sync observability.
 * This keeps backlog sizing separate from the heavier bounded row read path.
 */
export async function countPendingOperationLog(rawDb: SQLiteDatabase): Promise<number> {
  return countRowsForStatus(rawDb, 'pending');
}

/**
 * Prunes terminal operation-log history using TTL first and max-count second.
 * Active statuses remain untouched because deletion only targets synced and dead-letter rows.
 */
export async function pruneOperationLog(
  rawDb: SQLiteDatabase,
  policy: OperationLogRetentionPolicy = DEFAULT_OPERATION_LOG_RETENTION_POLICY,
): Promise<OperationLogPruneResult> {
  const now = policy.now();
  const syncedCutoff = buildRetentionCutoffTimestamp(now, policy.synced.ttlDays);
  const deadLetterCutoff = buildRetentionCutoffTimestamp(now, policy.deadLetter.ttlDays);

  const [deletedSyncedByTtl, deletedDeadLetterByTtl] = await Promise.all([
    pruneRowsByTtl(rawDb, policy.synced.status, syncedCutoff),
    pruneRowsByTtl(rawDb, policy.deadLetter.status, deadLetterCutoff),
  ]);
  // eslint-disable-next-line react-doctor/server-sequential-independent-await -- sequential by design: pruneRowsByMaxCount re-counts rows per status, so it must run after the TTL prune above completes or it would compute overflow against a stale (pre-TTL-deletion) count.
  const [deletedSyncedByOverflow, deletedDeadLetterByOverflow] = await Promise.all([
    pruneRowsByMaxCount(rawDb, policy.synced.status, policy.synced.maxCount),
    pruneRowsByMaxCount(
      rawDb,
      policy.deadLetter.status,
      policy.deadLetter.maxCount,
    ),
  ]);

  const deletedSyncedCount = deletedSyncedByTtl + deletedSyncedByOverflow;
  const deletedDeadLetterCount = deletedDeadLetterByTtl + deletedDeadLetterByOverflow;

  return {
    prunedCount: deletedSyncedCount + deletedDeadLetterCount,
    deletedSyncedCount,
    deletedDeadLetterCount,
  };
}
