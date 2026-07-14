import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient, extractActiveSeasonSnapshot } from '../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';

/** Identifies a reachable bridge response that cannot produce trustworthy active-season truth. */
export class ActiveSeasonSyncError extends Error {
  readonly status: number;
  readonly responseBody: string | null;

  constructor(message: string, status: number, responseBody: string | null) {
    super(message);
    this.name = 'ActiveSeasonSyncError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Fetches the bridge-owned active-season snapshot through the adapter seam and normalizes it.
 * Returning null is reserved for missing pairing or an explicit 404; reachable contract failures throw.
 */
export async function fetchActiveSeasonFromBridge(
  rawDb: SQLiteDatabase,
): Promise<ActiveSeasonSnapshot | null> {
  const config = await getBridgeConfigSnapshot(rawDb);

  if (!config?.ip || !config?.port || !config?.token) {
    return null;
  }

  const result = await bridgeClient.getActiveSeason({
    ip: config.ip,
    port: config.port,
    token: config.token,
  });

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
      nota_estreno?: unknown;
      nota_source?: unknown;
    };

    return (
      typeof value.anime_id === 'string' &&
      value.anime_id.length > 0 &&
      (value.nota_estreno === undefined ||
        value.nota_estreno === null ||
        (typeof value.nota_estreno === 'number' && Number.isFinite(value.nota_estreno))) &&
      (value.nota_source === undefined ||
        value.nota_source === null ||
        value.nota_source === 'bridge')
    );
  });
}
