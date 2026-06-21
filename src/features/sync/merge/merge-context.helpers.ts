import { inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../../infrastructure/db/client';
import { animes, operationLog } from '../../../infrastructure/db/schema';

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
 * Reads the set of anime ids with an unresolved local outbox operation (status `pending`
 * or `processing`), used by `decideMerge` to protect un-acked local intent from being
 * overwritten by an incoming remote change for the same anime.
 */
export async function loadPendingOutboxRecordIds(
  db: AppDatabase,
): Promise<Set<string>> {
  const rows = await db
    .select({ animeId: operationLog.animeId })
    .from(operationLog)
    .where(inArray(operationLog.status, ['pending', 'processing']));

  return new Set(rows.map((row) => row.animeId));
}
