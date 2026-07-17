import type { SQLiteDatabase } from 'expo-sqlite';
import { applyAnimePartial, upsertAnime } from '../../infrastructure/db/anime-repository';
import { getBridgeConfigSnapshot, withDeferredWrite } from '../../infrastructure/db/client/client.helpers';
import { animes } from '../../infrastructure/db/schema';
import { fetchInitialSyncSnapshot } from './initial-sync.helpers';
import { buildPartialUpdate, deriveChangedFields } from './merge/field-merge.helpers';
import { loadPendingOutboxRecordIds } from './merge/merge-context.helpers';

import type { ResyncResult } from './full-resync.types';

/**
 * Snapshot-authoritative heal: pulls the bridge's full current anime list and reconciles each
 * row against local SQLite by diffing, on the foreground reactive connection (`withDeferredWrite`)
 * so `useLiveQuery` refreshes immediately.
 *
 * This is the canonical recovery path for two situations the incremental changelog reconcile
 * cannot cover on its own:
 * - rows that drifted out of sync while blocked or during earlier failures (the changelog cursor
 *   has already advanced past those entries, so only a full snapshot can heal them), and
 * - changes a background cycle staged/missed while the app was away (a fresh full pull on
 *   foreground surfaces them without depending on the staging drain).
 *
 * It never clobbers un-acked local intent: animes with a pending/processing outbox op are
 * skipped (the outbox is the source of truth for those until confirmed). The per-anime guard is
 * preserved, not advanced, so a heal never shadows a genuinely newer changelog change.
 */
export async function resyncFromBridgeSnapshot(
  rawDb: SQLiteDatabase,
): Promise<ResyncResult> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    return { healed: 0 };
  }

  const remote = await fetchInitialSyncSnapshot({
    ip: config.ip,
    port: config.port,
    token: config.token,
  });

  if (remote.length === 0) {
    return { healed: 0 };
  }

  let healed = 0;

  await withDeferredWrite(rawDb, async (db) => {
    const [pendingOutboxRecordIds, localRows] = await Promise.all([
      loadPendingOutboxRecordIds(db),
      db.select().from(animes),
    ]);
    const localById = new Map(localRows.map((row) => [row._id, row]));

    for (const anime of remote) {
      if (pendingOutboxRecordIds.has(anime._id)) {
        continue;
      }

      const localRow = localById.get(anime._id);

      if (!localRow) {
        // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: writes and the `healed` counter share the single deferred-write transaction; parallelizing rows risks interleaving native SQLite statements on one connection.
        await upsertAnime(db, anime);
        healed += 1;
        continue;
      }

      const changedFields = deriveChangedFields(
        anime,
        localRow,
      );

      if (changedFields.length === 0) {
        continue;
      }

      const { columns } = buildPartialUpdate(changedFields, anime);
      // Preserve the existing guard (don't advance it): the heal is a full-truth correction,
      // not a newer change, so it must not shadow a later changelog entry.
      await applyAnimePartial(
        db,
        anime._id,
        columns,
        (localRow.lastAppliedChangeMs) ?? 0,
      );
      healed += 1;
    }
  });

  return { healed };
}
