import { and, eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../../infrastructure/db/client';
import { animes, operationLog } from '../../../infrastructure/db/schema';
import { ANIME_UPDATE_OPERATION } from '../outbox-operation.constants';

/**
 * Reads the per-anime staleness guard for the given record ids. A missing entry in the
 * returned map means the row was not found (caller should treat it the same as a NULL
 * guard via `?? null` at the read site, matching `decideMerge`'s lookup contract). Skips
 * the query entirely when `recordIds` is empty to avoid an `IN ()` round-trip.
 */
export async function loadGuardMap(
  db: AppDatabase,
  recordIds: readonly string[],
): Promise<Map<string, number | null>> {
  if (recordIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ _id: animes._id, lastAppliedChangeMs: animes.lastAppliedChangeMs })
    .from(animes)
    .where(inArray(animes._id, recordIds));

  return new Map(rows.map((row) => [row._id, row.lastAppliedChangeMs]));
}

/**
 * Reads the set of anime ids with an unconfirmed local edit (an `update` row, `pending` or
 * `processing`), used by `decideMerge` to protect un-acked local intent from being
 * overwritten by an incoming remote change for the same anime. A queued season rating is not
 * an edit of the anime's fields, so it never defers a remote change (L28).
 */
export async function loadPendingOutboxRecordIds(
  db: AppDatabase,
): Promise<Set<string>> {
  const rows = await db
    .select({ animeId: operationLog.animeId })
    .from(operationLog)
    .where(and(eq(operationLog.operation, ANIME_UPDATE_OPERATION), inArray(operationLog.status, ['pending', 'processing'])));

  return new Set(rows.map((row) => row.animeId));
}
