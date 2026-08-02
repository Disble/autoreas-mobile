import type { SQLiteDatabase } from 'expo-sqlite';
import { openAppDatabaseSync } from '../../infrastructure/db/client/client.helpers';
import { prepareHeadlessDatabase } from '../../infrastructure/db/startup/startup.helpers';
import { SYNC_SQLITE_OPEN_OPTIONS } from './sqlite-sync-runtime.constants';
import type {
  CloseableSQLiteDatabase,
  OpenSyncSQLiteRuntimeParams,
  SyncSQLiteRuntime,
} from './sqlite-sync-runtime.types';

/**
 * Closes a sync-owned SQLite connection with an async-first strategy and sync fallback.
 * Sync runtimes use this to guarantee teardown even when async close becomes unavailable late in the lifecycle.
 */
export async function closeSyncRuntime(rawDb: SQLiteDatabase): Promise<void> {
  const closeableDb = rawDb as CloseableSQLiteDatabase;
  let asyncCloseError: unknown;

  if (typeof closeableDb.closeAsync === 'function') {
    try {
      await closeableDb.closeAsync();
      return;
    } catch (error) {
      asyncCloseError = error;
    }
  }

  if (typeof closeableDb.closeSync === 'function') {
    closeableDb.closeSync();
    return;
  }

  if (asyncCloseError) {
    throw new Error('Failed to close the SQLite sync runtime.', { cause: asyncCloseError });
  }
}

/**
 * Creates a dedicated SQLite runtime for sync owners that need explicit open and close control.
 * The runtime caches one ready connection per owner instance and supports idempotent teardown.
 */
export function createSyncSQLiteRuntime(
  params: OpenSyncSQLiteRuntimeParams,
): SyncSQLiteRuntime {
  let rawDb: SQLiteDatabase | null = null;
  let openingPromise: Promise<SQLiteDatabase> | null = null;

  async function open(): Promise<SQLiteDatabase> {
    if (rawDb) {
      return rawDb;
    }

    if (openingPromise) {
      return openingPromise;
    }

    const openDatabase = params.openDatabase ?? openAppDatabaseSync;
    const prepareDatabase = params.prepareHeadlessDatabase ?? prepareHeadlessDatabase;

    openingPromise = (async () => {
      const nextRawDb = openDatabase(SYNC_SQLITE_OPEN_OPTIONS);

      try {
        await prepareDatabase(nextRawDb);
        rawDb = nextRawDb;
        return nextRawDb;
      } catch (error) {
        await closeSyncRuntime(nextRawDb);
        throw error;
      } finally {
        openingPromise = null;
      }
    })();

    return openingPromise;
  }

  async function close(): Promise<void> {
    if (!rawDb) {
      return;
    }

    const currentDb = rawDb;
    rawDb = null;
    await closeSyncRuntime(currentDb);
  }

  return {
    owner: params.owner,
    get rawDb() {
      return rawDb;
    },
    isOpen() {
      return rawDb !== null;
    },
    open,
    async withDatabase<TResult>(run: (db: SQLiteDatabase) => Promise<TResult>) {
      const currentDb = await open();
      return run(currentDb);
    },
    close,
  };
}
