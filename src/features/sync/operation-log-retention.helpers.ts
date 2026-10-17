import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  OperationLogBacklogStatus,
  OperationLogCountRow,
  OperationLogQueryParams,
} from './operation-log-retention.types';
import type { OperationLogRow } from '../../infrastructure/db/schema';

/** Builds the `?, ?, ...` placeholder list for a `status IN (...)` clause. */
function buildStatusPlaceholders(statusCount: number) {
  return Array.from({ length: statusCount }, () => '?').join(', ');
}

/** Counts operation-log rows for one status, the building block of `countOperationLogBacklogRows`. */
async function countRowsForStatus(rawDb: SQLiteDatabase, status: string) {
  const row = await rawDb.getFirstAsync<OperationLogCountRow>(
    'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
    status,
  );

  return Number(row?.count ?? 0);
}

/**
 * Builds the per-anime dedup query: a `ROW_NUMBER() OVER (PARTITION BY anime_id ORDER BY
 * created_at ASC, id ASC)` subquery filtered to rank 1, with the outer `ORDER BY`/`LIMIT`
 * applied AFTER the filter (design.md Decision 9). Both placements are load-bearing: the
 * partition ordering is what keeps per-anime FIFO deterministic even at equal `created_at`,
 * and running `LIMIT` outside the filtered subquery is what stops dedup from shrinking the
 * batch below its bound -- the window scans every matching row before either applies.
 */
function buildDedupedBacklogQuery(statusCount: number, skipClaimedKeys: boolean): string {
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
    ...(skipClaimedKeys
      ? ['  AND anime_id NOT IN (SELECT anime_id FROM operation_log WHERE claimed_at > ?)']
      : []),
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
    const claimFloor = params.skipKeysClaimedAfter;

    return rawDb.getAllAsync<OperationLogRow>(
      buildDedupedBacklogQuery(statuses.length, claimFloor !== undefined),
      ...statuses,
      ...(claimFloor === undefined ? [] : [claimFloor]),
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
 * Counts total operation-log rows across the given statuses, regardless of anime grouping.
 * Used ONLY to let `hasMorePending` report truthfully when a dedup batch (`readOperationLogBacklog`
 * with `dedupeBy: 'anime_id'`) suppressed rows behind the ones it returned -- 200 pending rows
 * across 3 animes yield a batch of 3, and comparing this total against that batch size is what
 * tells the caller 197 rows are still waiting. Reported-value only: nothing reruns on it.
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
