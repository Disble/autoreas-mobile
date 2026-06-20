import type { SQLiteDatabase } from 'expo-sqlite';
import type { OpenAppDatabaseSyncParams } from '../../infrastructure/db/client';

/**
 * Names the sync runtime owner responsible for a dedicated SQLite connection.
 */
export type SyncSQLiteOwner = 'headless_cycle' | 'foreground_service';

/**
 * Defines a SQLite database instance with close methods that may vary by runtime context.
 */
export type CloseableSQLiteDatabase = SQLiteDatabase & {
  readonly closeAsync?: () => Promise<void>;
  readonly closeSync?: () => void;
};

/**
 * Defines the dependencies used to open and prepare a sync-scoped SQLite runtime.
 */
export interface OpenSyncSQLiteRuntimeParams {
  readonly owner: SyncSQLiteOwner;
  readonly openDatabase?: (options?: OpenAppDatabaseSyncParams) => SQLiteDatabase;
  readonly runMigrations?: (rawDb: SQLiteDatabase) => Promise<unknown>;
}

/**
 * Defines the lifecycle contract for a dedicated sync SQLite runtime.
 */
export interface SyncSQLiteRuntime {
  readonly owner: SyncSQLiteOwner;
  readonly rawDb: SQLiteDatabase | null;
  readonly isOpen: () => boolean;
  readonly open: () => Promise<SQLiteDatabase>;
  readonly withDatabase: <TResult>(
    run: (rawDb: SQLiteDatabase) => Promise<TResult>,
  ) => Promise<TResult>;
  readonly close: () => Promise<void>;
}
