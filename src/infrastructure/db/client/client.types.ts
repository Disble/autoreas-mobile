import type { createDrizzleDb } from './client.helpers';

/** Defines the typed Drizzle database used by repositories. */
export type AppDatabase = ReturnType<typeof createDrizzleDb>;

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
