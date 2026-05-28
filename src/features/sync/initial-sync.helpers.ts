import { upsertAnime } from '../../infrastructure/db/anime-repository';
import { withDeferredWrite, withExclusiveWrite } from '../../infrastructure/db/client';
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
  const url = `http://${config.ip}:${config.port}/api/animes`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GET /api/animes failed: ${response.status}`);
  }

  const raw = await response.json();
  const parsed = AnimeListSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(`Invalid anime list from bridge: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Persists a fetched anime snapshot using the shared exclusive-write queue.
 * Reusing one writer keeps hydration consistent with the rest of the offline-first data layer.
 */
export async function persistInitialSyncSnapshot(
  rawDb: Parameters<typeof withExclusiveWrite>[0],
  remoteAnimes: Awaited<ReturnType<typeof fetchInitialSyncSnapshot>>,
): Promise<number> {
  if (remoteAnimes.length === 0) {
    return 0;
  }

  await withExclusiveWrite(rawDb, async (db) => {
    for (const anime of remoteAnimes) {
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
      await upsertAnime(db, anime);
    }
  });

  return remoteAnimes.length;
}
