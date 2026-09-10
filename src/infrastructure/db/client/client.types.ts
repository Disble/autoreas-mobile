import type { createDrizzleDb } from './client.helpers';

/** Defines the typed Drizzle database used by repositories. */
export type AppDatabase = ReturnType<typeof createDrizzleDb>;

/** Discriminates the transaction phase where a local write failed. */
export type LocalWriteFailureStage = 'begin' | 'task' | 'commit' | 'rollback' | 'deadline';

/**
 * Captures the write-failure diagnostics observable from JS, independent of the user-facing
 * error message. `errcode` is the SQLite PRIMARY result code only -- expo-sqlite never enables
 * extended result codes, so a value like `517` (SQLITE_BUSY_SNAPSHOT) is never observable here.
 */
export interface LocalWriteFailureDiagnostics {
  readonly errcode: number | null;
  readonly elapsedMs: number;
  readonly stage: LocalWriteFailureStage;
}

/** Defines supported SQLite connection ownership overrides. */
export interface OpenAppDatabaseSyncParams {
  readonly enableChangeListener?: boolean;
  readonly useNewConnection?: boolean;
}

/**
 * Defines an open request for a NON-app SQLite file, such as the sync-cycle telemetry database.
 * `busyTimeoutMs` is explicit because a side file wants a far shorter lock wait than the app
 * database's, and `databaseName` is required so this can never silently open `autoreas.db`.
 */
export interface OpenTelemetryDatabaseSyncParams {
  readonly databaseName: string;
  readonly useNewConnection: boolean;
  readonly enableChangeListener: boolean;
  readonly busyTimeoutMs: number;
}

/** Defines one idempotent column migration for a legacy SQLite table. */
export interface MissingColumnDefinition {
  readonly columnName: string;
  readonly sql: string;
}

/**
 * One row of the drizzle migrator's `__drizzle_migrations` ledger. `rowid` is the insertion
 * ordinal -- the migrator appends in journal order and the expo build writes an empty `hash`, so
 * position is the only thing that identifies which migration a row records.
 */
export interface MigrationLedgerRow {
  readonly rowid: number;
  readonly created_at: number;
}
