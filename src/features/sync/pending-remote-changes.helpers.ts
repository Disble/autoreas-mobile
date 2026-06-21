import { asc, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../infrastructure/db/client';
import { pendingRemoteChanges } from '../../infrastructure/db/schema';
import type { RemoteAnimeChange } from './merge/merge.types';

/**
 * A staging row paired with the `RemoteAnimeChange` it normalizes to, plus the staging
 * table's own `id` (`stagingId`) so callers can delete exactly the rows they drained
 * without re-deriving a match against the original change.
 */
export interface PendingRemoteChangeEntry {
  readonly stagingId: number;
  readonly change: RemoteAnimeChange;
}

/**
 * Persists a batch of normalized remote changes into the `pending_remote_changes` staging
 * table instead of applying them to `animes`. Used by background/headless sync runs (no
 * reactive change listener, separate JS runtime) so a foreground drain can later apply them
 * via the merge boundary on the shared reactive connection. Pure IO: never writes `animes`.
 */
export async function stagePendingRemoteChanges(
  db: AppDatabase,
  changes: readonly RemoteAnimeChange[],
  now: () => number = Date.now,
): Promise<void> {
  if (changes.length === 0) {
    return;
  }

  const createdAt = now();

  await db.insert(pendingRemoteChanges).values(
    changes.map((change) => ({
      recordId: change.recordId,
      changeType: change.changeType,
      changedFields: JSON.stringify(change.changedFields),
      snapshot: change.snapshot ? JSON.stringify(change.snapshot) : null,
      timestamp: change.timestamp,
      createdAt,
    })),
  );
}

/**
 * Reads all staged remote changes ordered by `timestamp` ascending (drain order), parsing
 * each row back into a `RemoteAnimeChange` plus its staging `id`. Order matters: the drain
 * loop must apply changes in the order they originally arrived so the staleness guard sees
 * a monotonically increasing timestamp per anime.
 */
export async function loadPendingRemoteChanges(
  db: AppDatabase,
): Promise<PendingRemoteChangeEntry[]> {
  const rows = await db
    .select()
    .from(pendingRemoteChanges)
    .orderBy(asc(pendingRemoteChanges.timestamp));

  return rows.map((row) => ({
    stagingId: row.id,
    change: {
      recordId: row.recordId,
      changeType: row.changeType as RemoteAnimeChange['changeType'],
      changedFields: JSON.parse(row.changedFields) as readonly string[],
      snapshot: row.snapshot ? JSON.parse(row.snapshot) : undefined,
      timestamp: row.timestamp,
    },
  }));
}

/**
 * Deletes drained staging rows by id. Intended to run in the same deferred transaction as
 * the apply step so a crash between apply and delete cannot silently drop a change (the
 * drain re-reads and re-applies on the next pass; the staleness guard makes that re-apply
 * a safe no-op for already-applied rows).
 */
export async function deletePendingRemoteChanges(
  db: AppDatabase,
  stagingIds: readonly number[],
): Promise<void> {
  if (stagingIds.length === 0) {
    return;
  }

  await db
    .delete(pendingRemoteChanges)
    .where(inArray(pendingRemoteChanges.id, stagingIds));
}
