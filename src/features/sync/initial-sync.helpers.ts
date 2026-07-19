import { bridgeClient } from '../../infrastructure/api';
import { upsertAnime } from '../../infrastructure/db/anime-repository';
import { withDeferredWrite, withExclusiveWrite } from '../../infrastructure/db/client/client.helpers';
import { bridgeConfig } from '../../infrastructure/db/schema';
import { AnimeListSchema } from './initial-sync.schema';
import type {
  BridgeConnectionConfig,
  BridgeFetchCredentials,
} from './initial-sync.types';

/**
 * Fetches the first full anime snapshot for a bridge connection.
 * Pairing uses this before persistence so setup only commits when the bridge is already usable.
 */
export async function fetchInitialSyncSnapshot(
  config: BridgeFetchCredentials,
) {
  const result = await bridgeClient.listAnimes({
    ip: config.ip,
    port: config.port,
    token: config.token,
  });

  if (!result.ok) {
    throw new Error(`GET /api/animes failed: ${result.status}`);
  }

  const parsed = AnimeListSchema.safeParse(result.data);

  if (!parsed.success) {
    throw new Error(`Invalid anime list from bridge: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Persists a fetched anime snapshot using the queued non-exclusive write path.
 * Writing on the shared connection keeps `useLiveQuery` consumers reactive so the list
 * hydrates immediately, while the write queue still preserves per-database ordering.
 */
export async function persistInitialSyncSnapshot(
  rawDb: Parameters<typeof withDeferredWrite>[0],
  remoteAnimes: Awaited<ReturnType<typeof fetchInitialSyncSnapshot>>,
): Promise<number> {
  if (remoteAnimes.length === 0) {
    return 0;
  }

  await withDeferredWrite(rawDb, async (db) => {
    for (const anime of remoteAnimes) {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: all upserts share one deferred-write transaction on a single SQLite connection; parallelizing risks interleaving native statements on the same handle.
      await upsertAnime(db, anime);
    }
  });

  return remoteAnimes.length;
}

/**
 * Commits bridge credentials and the initial anime snapshot inside one deferred transaction.
 * Using the queued non-exclusive path keeps `useLiveQuery` consumers reactive while still
 * rolling back the whole pairing write if any insert/upsert fails.
 */
export async function persistPairedBridgeConfiguration(
  rawDb: Parameters<typeof withExclusiveWrite>[0],
  config: BridgeConnectionConfig,
  remoteAnimes: Awaited<ReturnType<typeof fetchInitialSyncSnapshot>>,
): Promise<number> {
  await withDeferredWrite(rawDb, async (db) => {
    await db.delete(bridgeConfig);
    await db.insert(bridgeConfig).values({
      ip: config.ip,
      port: config.port,
      token: config.token,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
    });

    for (const anime of remoteAnimes) {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: all upserts share one deferred-write transaction on a single SQLite connection; parallelizing risks interleaving native statements on the same handle.
      await upsertAnime(db, anime);
    }
  });

  return remoteAnimes.length;
}
