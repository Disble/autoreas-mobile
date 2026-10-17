import type { SQLiteDatabase } from 'expo-sqlite';
import {
  SEASON_RATING_OPERATION_INSERT_SQL,
  SEASON_RATING_QUEUE_DROP_SQL,
  SEASON_RATING_QUEUE_LOOKUP_SQL,
  SEASON_RATING_QUEUE_READ_SQL,
  UNRESOLVED_QUEUED_RATING_KINDS,
} from './season-rating-queue-move.constants';
import type { MovedRatingOperation, QueuedRatingRow } from './season-rating-queue-move.types';

/**
 * Maps one queued rating to its `operation_log` row (ADR 009 L28). A rating the bridge refused
 * (`failed` with an unresolved kind) stays unresolved with that reason; everything else, `syncing`
 * included, is `pending` again, because no runtime holds it once the app restarts. The payload is
 * byte-identical to the one `enqueueSeasonRatingIntent` writes, and `created_at` is kept.
 */
function mapQueuedRating(row: QueuedRatingRow): MovedRatingOperation {
  const unresolved =
    row.status === 'failed' &&
    row.last_failure_kind !== null &&
    UNRESOLVED_QUEUED_RATING_KINDS.includes(row.last_failure_kind);

  return {
    animeId: row.anime_id,
    payload: JSON.stringify({ seasonId: row.season_id, grade: row.nota, ratedAt: row.rated_at }),
    status: unresolved ? 'dead_letter' : 'pending',
    createdAt: row.created_at,
    unresolvedReason: unresolved ? row.last_failure_kind : null,
  };
}

/**
 * Moves every rating of the retired `season_rating_queue` into `operation_log` and drops the
 * table, in ONE exclusive transaction (migration 0019's repair twin). An installed device never
 * runs 0019's `.sql` -- `reconcileMigrationLedger` pins the gate -- so this step is its only route.
 *
 * - Idempotent: with no table (a fresh install's 0019 dropped it, or a previous launch moved it)
 *   it returns before opening a transaction.
 * - Ordered: rows are inserted oldest first (`created_at, id`), so the new ids keep queue order
 *   after the rows already in `operation_log`.
 * - All or nothing: any failure rolls the inserts back with the drop, the queue stays intact, and
 *   the error propagates so readiness is not stamped; the next launch retries the whole move.
 *
 * It must run after `ensureOperationLogColumns`, which gives `operation_log` the claim and
 * `unresolved_reason` columns the insert names.
 */
export async function moveSeasonRatingQueueIntoOperationLog(rawDb: SQLiteDatabase): Promise<void> {
  if (!(await rawDb.getFirstAsync<{ name: string }>(SEASON_RATING_QUEUE_LOOKUP_SQL))) {
    return;
  }

  // Outside the rollback guard, like `withLocalWrite`: a BEGIN that fails opened nothing to roll back.
  await rawDb.execAsync('BEGIN EXCLUSIVE');

  try {
    const rows = await rawDb.getAllAsync<QueuedRatingRow>(SEASON_RATING_QUEUE_READ_SQL);

    // Chained one after another, like `ensureMissingColumns`: each insert takes the next id, so
    // running them in parallel would lose the queue order the ids must keep.
    await rows.map(mapQueuedRating).reduce<Promise<unknown>>(
      (previous, moved) =>
        previous.then(() =>
          rawDb.runAsync(
            SEASON_RATING_OPERATION_INSERT_SQL,
            moved.animeId,
            moved.payload,
            moved.status,
            moved.createdAt,
            moved.unresolvedReason,
          ),
        ),
      Promise.resolve(),
    );

    await rawDb.runAsync(SEASON_RATING_QUEUE_DROP_SQL);
    await rawDb.execAsync('COMMIT');
  } catch (error) {
    await rawDb.execAsync('ROLLBACK');
    throw error;
  }
}
