import type { SQLiteDatabase } from 'expo-sqlite';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';
import { ACTIVE_SEASON_REFRESH_GENERATION } from './active-season-refresh.constants';
import {
  clearCachedActiveSeasonSnapshot,
  fetchActiveSeasonFromBridge,
  writeCachedActiveSeasonSnapshot,
} from './season-sync.helpers';

/** Starts a newer active-season refresh and returns its generation. */
export function beginActiveSeasonRefresh(): number {
  ACTIVE_SEASON_REFRESH_GENERATION.current += 1;

  return ACTIVE_SEASON_REFRESH_GENERATION.current;
}

/** Makes every refresh in flight stale, so none of them publishes or caches its late answer. */
export function invalidateActiveSeasonRefresh(): void {
  ACTIVE_SEASON_REFRESH_GENERATION.current += 1;
}

/** Tells whether `generation` is still the newest refresh, with no clear after it. */
export function isCurrentActiveSeasonRefresh(generation: number): boolean {
  return generation === ACTIVE_SEASON_REFRESH_GENERATION.current;
}

/**
 * Fetches the active season, publishes it, and keeps the offline cache in step: a returned season is
 * cached, a confirmed absence clears the cache. The dispatched cycle runs this after a delivered
 * rating and for the WebSocket season events (ADR 009 R-2, I8).
 *
 * Best effort, never a cycle failure: a failed fetch is logged and keeps the published and cached
 * snapshot, as a failed rating never fails the cycle (ADR 009 R-5). A refresh made stale by a
 * newer one or by a clear (season mode switched off) publishes and caches nothing.
 */
export async function refreshActiveSeasonSnapshot(
  rawDb: SQLiteDatabase,
  publishSnapshot: (snapshot: ActiveSeasonSnapshot | null) => void,
): Promise<void> {
  const generation = beginActiveSeasonRefresh();
  let snapshot: ActiveSeasonSnapshot | null;

  try {
    snapshot = await fetchActiveSeasonFromBridge(rawDb);
  } catch (error) {
    console.warn('[refreshActiveSeasonSnapshot] Active season refresh failed; keeping the cached snapshot', error);
    return;
  }

  if (!isCurrentActiveSeasonRefresh(generation)) {
    return;
  }

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
