import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient, extractSeasonMode } from '../../infrastructure/api';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';

/**
 * Fetches the bridge's current season-mode flag for a cold hydration of the global store.
 * Returns null (not false) on missing pairing config, an unreachable bridge, or a non-OK
 * response, so a transient failure never clobbers a known value — the WebSocket push stays
 * the live channel and will deliver the next change. The bridge is the single source of
 * truth, so this read is one-way (mobile never writes the flag back).
 */
export async function fetchSeasonModeFromBridge(
  rawDb: SQLiteDatabase,
): Promise<boolean | null> {
  try {
    const config = await getBridgeConfigSnapshot(rawDb);

    if (!config?.ip || !config?.port || !config?.token) {
      return null;
    }

    const result = await bridgeClient.getStatus({
      ip: config.ip,
      port: config.port,
      token: config.token,
    });

    if (!result.ok) {
      return null;
    }

    return extractSeasonMode(result.data);
  } catch {
    return null;
  }
}
