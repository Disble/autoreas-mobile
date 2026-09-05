import type { SQLiteDatabase } from 'expo-sqlite';
import { withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import {
  DEFAULT_OPERATION_LOG_RETENTION_POLICY,
  OPERATION_LOG_RETENTION_DAY_IN_MS,
} from './operation-log-retention.constants';
import type {
  OperationLogBacklogStatus,
  OperationLogCountRow,
  OperationLogPruneResult,
  OperationLogQueryParams,
  OperationLogRetentionPolicy,
} from './operation-log-retention.types';
import type { OperationLogRow } from '../../infrastructure/db/schema';

/** Builds the `?, ?, ...` placeholder list for a `status IN (...)` clause. */
function buildStatusPlaceholders(statusCount: number) {
  return Array.from({ length: statusCount }, () => '?').join(', ');
}

/** Computes the epoch-ms cutoff before which a row of the given TTL is eligible for pruning. */
function buildRetentionCutoffTimestamp(now: number, ttlDays: number) {
  return now - ttlDays * OPERATION_LOG_RETENTION_DAY_IN_MS;
}

/** Counts operation-log rows for one status, the shared building block behind every count/prune query. */
async function countRowsForStatus(rawDb: SQLiteDatabase, status: string) {
  const row = await rawDb.getFirstAsync<OperationLogCountRow>(
    'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
    status,
  );

  return Number(row?.count ?? 0);
}

/** Deletes rows of one terminal status older than the given cutoff, oldest first. */
async function pruneRowsByTtl(
  tx: SQLiteDatabase,
  status: string,
  cutoffTimestamp: number,
) {
  const result = await tx.runAsync(
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

/** Deletes the oldest rows of one terminal status once its count exceeds `maxCount`. */
async function pruneRowsByMaxCount(
  tx: SQLiteDatabase,
  status: string,
  maxCount: number,
) {
  const currentCount = await countRowsForStatus(tx, status);
  const overflowCount = Math.max(0, currentCount - maxCount);

  if (overflowCount === 0) {
    return 0;
  }

  const result = await tx.runAsync(
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
 * Builds the per-anime dedup query: a `ROW_NUMBER() OVER (PARTITION BY anime_id ORDER BY
 * created_at ASC, id ASC)` subquery filtered to rank 1, with the outer `ORDER BY`/`LIMIT`
 * applied AFTER the filter (design.md Decision 9). Both placements are load-bearing: the
 * partition ordering is what keeps per-anime FIFO deterministic even at equal `created_at`,
 * and running `LIMIT` outside the filtered subquery is what stops dedup from shrinking the
 * batch below its bound -- the window scans every matching row before either applies.
 */
function buildDedupedBacklogQuery(statusCount: number): string {
  return [
    'SELECT id, animeId, operation, payload, status, createdAt, conflictAttemptCount FROM (',
    '  SELECT',
    '    id,',
    '    anime_id AS animeId,',
    '    operation,',
    '    payload,',
    '    status,',
    '    created_at AS createdAt,',
    '    conflict_attempt_count AS conflictAttemptCount,',
    '    ROW_NUMBER() OVER (',
    '      PARTITION BY anime_id ORDER BY created_at ASC, id ASC',
    '    ) AS animeRank',
    '  FROM operation_log',
    `  WHERE status IN (${buildStatusPlaceholders(statusCount)})`,
    ')',
    'WHERE animeRank = 1',
    'ORDER BY createdAt ASC, id ASC',
    'LIMIT ?',
  ].join(' ');
}

/**
 * Reads a bounded, stable operation-log backlog without materializing the entire queue.
 * The query always orders by age so future reconcile batching can continue incrementally.
 *
 * `params.dedupeBy: 'anime_id'` opts into the per-anime dedup (`buildDedupedBacklogQuery`);
 * absent, this stays the flat query it always was, byte-identical.
 */
export async function readOperationLogBacklog(
  rawDb: SQLiteDatabase,
  params: OperationLogQueryParams,
): Promise<OperationLogRow[]> {
  if (params.status.length === 0 || params.limit <= 0) {
    return [];
  }

  const statuses = [...params.status];

  if (params.dedupeBy === 'anime_id') {
    return rawDb.getAllAsync<OperationLogRow>(
      buildDedupedBacklogQuery(statuses.length),
      ...statuses,
      params.limit,
    );
  }

  const query = [
    'SELECT',
    '  id,',
    '  anime_id AS animeId,',
    '  operation,',
    '  payload,',
    '  status,',
    '  created_at AS createdAt,',
    '  conflict_attempt_count AS conflictAttemptCount',
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
 * Counts total operation-log rows across the given statuses, regardless of anime grouping.
 * Used ONLY to let `hasMorePending` report truthfully when a dedup batch (`readOperationLogBacklog`
 * with `dedupeBy: 'anime_id'`) suppressed rows behind the ones it returned -- 200 pending rows
 * across 3 animes yield a batch of 3, and comparing this total against that batch size is what
 * tells the caller 197 rows are still waiting. Reported-value only: `syncPendingOperations`'s
 * rerun loop is driven by `syncState.rerunRequested`, never by this count.
 */
export async function countOperationLogBacklogRows(
  rawDb: SQLiteDatabase,
  statuses: readonly OperationLogBacklogStatus[],
): Promise<number> {
  const counts = await Promise.all(
    statuses.map((status) => countRowsForStatus(rawDb, status)),
  );

  return counts.reduce((total, count) => total + count, 0);
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
  const conflictExhaustedCutoff = buildRetentionCutoffTimestamp(
    now,
    policy.conflictExhausted.ttlDays,
  );

  return withLocalWrite(rawDb, async (_db, tx) => {
    const [deletedSyncedByTtl, deletedDeadLetterByTtl, deletedConflictExhaustedByTtl] =
      await Promise.all([
        pruneRowsByTtl(tx, policy.synced.status, syncedCutoff),
        pruneRowsByTtl(tx, policy.deadLetter.status, deadLetterCutoff),
        pruneRowsByTtl(tx, policy.conflictExhausted.status, conflictExhaustedCutoff),
      ]);
    // eslint-disable-next-line react-doctor/server-sequential-independent-await -- sequential by design: pruneRowsByMaxCount re-counts rows per status, so it must run after the TTL prune above completes or it would compute overflow against a stale (pre-TTL-deletion) count.
    const [deletedSyncedByOverflow, deletedDeadLetterByOverflow, deletedConflictExhaustedByOverflow] =
      await Promise.all([
        pruneRowsByMaxCount(tx, policy.synced.status, policy.synced.maxCount),
        pruneRowsByMaxCount(
          tx,
          policy.deadLetter.status,
          policy.deadLetter.maxCount,
        ),
        pruneRowsByMaxCount(
          tx,
          policy.conflictExhausted.status,
          policy.conflictExhausted.maxCount,
        ),
      ]);

    const deletedSyncedCount = deletedSyncedByTtl + deletedSyncedByOverflow;
    const deletedDeadLetterCount = deletedDeadLetterByTtl + deletedDeadLetterByOverflow;
    const deletedConflictExhaustedCount =
      deletedConflictExhaustedByTtl + deletedConflictExhaustedByOverflow;

    return {
      prunedCount: deletedSyncedCount + deletedDeadLetterCount + deletedConflictExhaustedCount,
      deletedSyncedCount,
      deletedDeadLetterCount,
      deletedConflictExhaustedCount,
    };
  });
}
