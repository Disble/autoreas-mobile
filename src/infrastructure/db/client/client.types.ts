import type { createDrizzleDb } from './client.helpers';

/** Defines the typed Drizzle database used by repositories. */
export type AppDatabase = ReturnType<typeof createDrizzleDb>;

/** Discriminates the transaction phase where a local write failed. */
export type LocalWriteFailureStage = 'begin' | 'task' | 'commit' | 'rollback';

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

/** Defines one idempotent column migration for a legacy SQLite table. */
export interface MissingColumnDefinition {
  readonly columnName: string;
  readonly sql: string;
}
