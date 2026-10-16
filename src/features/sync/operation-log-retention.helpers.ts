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

/**
 * Counts operation-log rows for one status, the shared building block behind every count/prune
 * query. Exported so `operation-log-convergence.helpers.ts` composes it directly instead of
 * duplicating this `COUNT` (design.md Decision 1) -- `countOperationLogBacklogRows` below is the
 * in-repo precedent for that composition.
 */
export async function countRowsForStatus(rawDb: SQLiteDatabase, status: string) {
  const row = await rawDb.getFirstAsync<OperationLogCountRow>(
    'SELECT COUNT(*) AS count FROM operation_log WHERE status = ?',
    status,
  );

  return Number(row?.count ?? 0);
}

/** Deletes `synced` rows older than the given cutoff, oldest first. */
async function pruneSyncedRowsByTtl(tx: SQLiteDatabase, cutoffTimestamp: number) {
  const result = await tx.runAsync(
    [
      'DELETE FROM operation_log',
      'WHERE id IN (',
      '  SELECT id FROM operation_log',
      "  WHERE status = 'synced' AND created_at < ?",
      '  ORDER BY created_at ASC, id ASC',
      ')',
    ].join(' '),
    cutoffTimestamp,
  );

  return result.changes;
}

/** Deletes the oldest `synced` rows once their count exceeds `maxCount`. */
async function pruneSyncedRowsByMaxCount(tx: SQLiteDatabase, maxCount: number) {
  const currentCount = await countRowsForStatus(tx, 'synced');
  const overflowCount = Math.max(0, currentCount - maxCount);

  if (overflowCount === 0) {
    return 0;
  }

  const result = await tx.runAsync(
    [
      'DELETE FROM operation_log',
      'WHERE id IN (',
      '  SELECT id FROM operation_log',
      "  WHERE status = 'synced'",
      '  ORDER BY created_at ASC, id ASC',
      '  LIMIT ?',
      ')',
    ].join(' '),
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
 * Prunes `synced` operation-log history using TTL first and max-count second. Every other
 * status is untouched: active rows are still in flight, and given-up rows (`dead_letter`,
 * `conflict_exhausted`) are unresolved keys that stay until resolved (ADR 009 R-16b).
 */
export async function pruneOperationLog(
  rawDb: SQLiteDatabase,
  policy: OperationLogRetentionPolicy = DEFAULT_OPERATION_LOG_RETENTION_POLICY,
): Promise<OperationLogPruneResult> {
  const syncedCutoff = buildRetentionCutoffTimestamp(policy.now(), policy.synced.ttlDays);

  return withLocalWrite(rawDb, async (_db, tx) => {
    const deletedByTtl = await pruneSyncedRowsByTtl(tx, syncedCutoff);
    // eslint-disable-next-line react-doctor/server-sequential-independent-await -- sequential by design: the max-count pass re-counts rows, so it must run after the TTL delete or it would compute overflow against a stale count.
    const deletedByOverflow = await pruneSyncedRowsByMaxCount(tx, policy.synced.maxCount);

    return { deletedSyncedCount: deletedByTtl + deletedByOverflow };
  });
}
