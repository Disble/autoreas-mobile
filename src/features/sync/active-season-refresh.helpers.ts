import type { SQLiteDatabase } from 'expo-sqlite';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';
import {
  clearCachedActiveSeasonSnapshot,
  fetchActiveSeasonFromBridge,
  writeCachedActiveSeasonSnapshot,
} from './season-sync.helpers';

/**
 * Fetches the active season, publishes it, and keeps the offline cache in step: a returned season is
 * cached, a confirmed absence clears the cache. The dispatched cycle runs this after a delivered
 * rating and for the WebSocket season events (ADR 009 R-2, I8). A fetch failure throws to the
 * cycle; a cache write failure does not, since the published bridge result stays usable.
 */
export async function refreshActiveSeasonSnapshot(
  rawDb: SQLiteDatabase,
  publishSnapshot: (snapshot: ActiveSeasonSnapshot | null) => void,
): Promise<void> {
  const snapshot = await fetchActiveSeasonFromBridge(rawDb);
  publishSnapshot(snapshot);

  try {
    if (snapshot) {
      await writeCachedActiveSeasonSnapshot(rawDb, snapshot);
    } else {
      await clearCachedActiveSeasonSnapshot(rawDb);
    }
  } catch (error) {
    console.warn('[refreshActiveSeasonSnapshot] Active season cache was not updated', error);
  }
}
