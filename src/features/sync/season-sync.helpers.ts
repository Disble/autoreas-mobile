import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient, extractActiveSeasonSnapshot } from '../../infrastructure/api';
import {
  getBridgeConfigSnapshot,
  withLocalWrite,
} from '../../infrastructure/db/client/client.helpers';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';
import type { RequestIdSequence } from './request-id.types';
import { ActiveSeasonSyncError } from './season-sync.errors';

/**
 * Fetches the bridge-owned active-season snapshot through the adapter seam and normalizes it.
 * Returning null is reserved for missing pairing or an explicit 404; reachable contract failures throw.
 * The request takes the next id of `requestIds` when a sync cycle makes it, and carries none otherwise.
 */
export async function fetchActiveSeasonFromBridge(
  rawDb: SQLiteDatabase,
  requestIds?: RequestIdSequence,
): Promise<ActiveSeasonSnapshot | null> {
  const config = await getBridgeConfigSnapshot(rawDb);

  if (!config?.ip || !config?.port || !config?.token) {
    return null;
  }

  const connection = { ip: config.ip, port: config.port, token: config.token };
  // Outside a cycle (the season screen) the call stays exactly what it was: no options, no id.
  const result = requestIds
    ? await bridgeClient.getActiveSeason(connection, { requestId: requestIds.next() })
    : await bridgeClient.getActiveSeason(connection);

  if (result.status === 404) {
    return null;
  }

  if (!result.ok) {
    throw new ActiveSeasonSyncError(
      `Active season fetch failed: ${result.status}`,
      result.status,
      result.rawBody,
    );
  }

  const snapshot = extractActiveSeasonSnapshot(result.data);

  if (!snapshot || !isValidActiveSeasonPayload(result.data)) {
    throw new ActiveSeasonSyncError(
      'Invalid active season response',
      result.status,
      result.rawBody,
    );
  }

  return snapshot;
}

/**
 * Restores the last bridge-confirmed season membership so offline startup can render season controls.
 * Malformed cache rows are ignored because the bridge remains the source of eligibility truth.
 */
export async function readCachedActiveSeasonSnapshot(
  rawDb: SQLiteDatabase,
): Promise<ActiveSeasonSnapshot | null> {
  const row = await rawDb.getFirstAsync<{
    season_id: string;
    candidates_json: string;
  }>('SELECT season_id, candidates_json FROM active_season_cache WHERE id = 1');

  if (!row) {
    return null;
  }

  try {
    const candidates: unknown = JSON.parse(row.candidates_json);

    return extractActiveSeasonSnapshot({
      season_id: row.season_id,
      candidates,
    });
  } catch {
    return null;
  }
}

/**
 * Persists bridge-confirmed candidate membership for a later offline launch.
 * The single-row upsert keeps only the latest active season because prior seasons are never eligible.
 */
export async function writeCachedActiveSeasonSnapshot(
  rawDb: SQLiteDatabase,
  snapshot: ActiveSeasonSnapshot,
): Promise<void> {
  await withLocalWrite(rawDb, async (_db, tx) => {
    await tx.runAsync(
      'INSERT INTO active_season_cache (id, season_id, candidates_json) VALUES (1, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET season_id = excluded.season_id, candidates_json = excluded.candidates_json',
      snapshot.seasonId,
      JSON.stringify(
        snapshot.candidates.map((candidate) => ({
          anime_id: candidate.animeId,
          grade: candidate.bridgeRating,
          grade_source: candidate.bridgeRatingSource,
        })),
      ),
    );
  });
}

/**
 * Removes locally cached membership when the bridge explicitly confirms no season is active.
 * This prevents a retired season from remaining available after the next offline launch.
 */
export async function clearCachedActiveSeasonSnapshot(rawDb: SQLiteDatabase): Promise<void> {
  await withLocalWrite(rawDb, async (_db, tx) => {
    await tx.runAsync('DELETE FROM active_season_cache WHERE id = 1');
  });
}

/**
 * Tells whether an active-season body carries a non-empty `season_id` and a well-formed
 * `candidates` array, so a snapshot is never built from a payload the bridge did not mean.
 */
function isValidActiveSeasonPayload(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const payload = data as { season_id?: unknown; candidates?: unknown };

  if (
    typeof payload.season_id !== 'string' ||
    payload.season_id.length === 0 ||
    !Array.isArray(payload.candidates)
  ) {
    return false;
  }

  return payload.candidates.every((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      return false;
    }

    const value = candidate as {
      anime_id?: unknown;
      grade?: unknown;
      grade_source?: unknown;
    };

    return (
      typeof value.anime_id === 'string' &&
      value.anime_id.length > 0 &&
      (value.grade === undefined ||
        value.grade === null ||
        (typeof value.grade === 'number' && Number.isFinite(value.grade))) &&
      (value.grade_source === undefined ||
        value.grade_source === null ||
        value.grade_source === 'bridge')
    );
  });
}
