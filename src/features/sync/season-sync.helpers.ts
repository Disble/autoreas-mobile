import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient, extractActiveSeasonSnapshot } from '../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';

/**
 * Fetches the bridge-owned active-season snapshot through the adapter seam and normalizes it.
 * Returning null for missing pairing, inactive season, or malformed payload prevents client-owned inference.
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
    return null;
  }

  return extractActiveSeasonSnapshot(result.data);
}
