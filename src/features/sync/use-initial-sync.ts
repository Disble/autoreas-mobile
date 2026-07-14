import type { SQLiteDatabase } from "expo-sqlite";
import { getBridgeConfigSnapshot } from "../../infrastructure/db/client";
import {
  fetchInitialSyncSnapshot,
  persistInitialSyncSnapshot,
} from './initial-sync.helpers';

/** Executes the initial sync operation. */
export async function initialSync(rawDb: SQLiteDatabase): Promise<number> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    throw new Error("Bridge config is missing or incomplete");
  }

  const remoteAnimes = await fetchInitialSyncSnapshot({
    ip: config.ip,
    port: config.port,
    token: config.token,
  });

  return persistInitialSyncSnapshot(rawDb, remoteAnimes);
}

