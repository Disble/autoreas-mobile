import type { OpenAppDatabaseSyncParams } from '../../infrastructure/db/client';

/**
 * Defines the sync-scoped SQLite open options that disable reactive listeners and force connection isolation.
 */
export const SYNC_SQLITE_OPEN_OPTIONS: OpenAppDatabaseSyncParams = {
  enableChangeListener: false,
  useNewConnection: true,
};
