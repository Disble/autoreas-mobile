import { desc } from "drizzle-orm";
import type { SQLiteDatabase } from "expo-sqlite";
import migrations from "../migrations/migrations";
import {
  getDrizzleFactory,
  getDrizzleMigrator,
  getOpenDatabaseSync,
} from "../native-runtime/native-runtime.helpers";
import * as schema from "../schema";

import {
  DATABASE_NAME,
  SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
  WRITE_QUEUE_BY_DATABASE,
} from './client.constants';
import type {
  AppDatabase,
  MissingColumnDefinition,
  OpenAppDatabaseSyncParams,
} from './client.types';

/** Executes the open app database sync operation. */
export function openAppDatabaseSync(options: OpenAppDatabaseSyncParams = {}) {
  const openDatabaseSync = getOpenDatabaseSync();
  const {
    enableChangeListener = true,
    useNewConnection = false,
  } = options;

  return openDatabaseSync(DATABASE_NAME, {
    enableChangeListener,
    useNewConnection,
  });
}

/** Executes the create drizzle db operation. */
export function createDrizzleDb(rawDb: SQLiteDatabase) {
  const drizzle = getDrizzleFactory();
  return drizzle(rawDb, { schema });
}

async function ensureBridgeConfigLastChangelogId(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(bridge_config)');
  const hasLastChangelogId = columns.some((column) => column.name === 'last_changelog_id');

  if (!hasLastChangelogId) {
    await rawDb.runAsync(
      'ALTER TABLE bridge_config ADD COLUMN last_changelog_id INTEGER DEFAULT 0'
    );
  }

  await rawDb.runAsync(
    "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0 OR last_changelog_id > 1000000000000"
  );
}

async function ensureSyncRuntimeStatusExecutionColumns(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(sync_runtime_status)');
  const columnNames = new Set(columns.map((column) => column.name));

  await ensureMissingColumns(
    rawDb,
    columnNames,
    SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS,
  );
}

/** Applies missing SQLite columns in declaration order while skipping existing columns. */
export async function ensureMissingColumns(
  rawDb: SQLiteDatabase,
  existingColumnNames: ReadonlySet<string>,
  definitions: readonly MissingColumnDefinition[],
): Promise<void> {
  const missingDefinitions = definitions.filter(
    (definition) => !existingColumnNames.has(definition.columnName),
  );

  await missingDefinitions.reduce<Promise<void>>(
    (previousMigration, definition) =>
      previousMigration
        .then(() => rawDb.runAsync(definition.sql))
        .then(() => undefined),
    Promise.resolve(),
  );
}

async function ensureOperationLogRetentionIndex(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE INDEX IF NOT EXISTS operation_log_status_created_at_idx ON operation_log(status, created_at, id)'
  );
}

/**
 * Adds the per-anime staleness-guard column when missing. The column is intentionally
 * nullable with no default and no backfill: NULL means "older than any remote change",
 * so every pre-existing row accepts the first remote change that targets it.
 */
async function ensureAnimesGuardColumn(rawDb: SQLiteDatabase) {
  const columns = await rawDb.getAllAsync<{ name: string }>('PRAGMA table_info(animes)');
  const hasGuardColumn = columns.some((column) => column.name === 'last_applied_change_ms');

  if (!hasGuardColumn) {
    await rawDb.runAsync(
      'ALTER TABLE animes ADD COLUMN last_applied_change_ms INTEGER'
    );
  }
}

/**
 * Creates the `pending_remote_changes` staging table when missing. Background/headless
 * sync runs (no reactive change listener, separate JS runtime) write remote changes here
 * instead of applying them to `animes` directly; a foreground drain hook later applies
 * them via the merge boundary on the shared reactive connection. `IF NOT EXISTS` keeps
 * reruns a no-op without needing a PRAGMA existence check first.
 */
async function ensurePendingRemoteChangesTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE TABLE IF NOT EXISTS pending_remote_changes (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'record_id TEXT NOT NULL, ' +
      'change_type TEXT NOT NULL, ' +
      'changed_fields TEXT NOT NULL, ' +
      'snapshot TEXT, ' +
      'timestamp INTEGER NOT NULL, ' +
      'created_at INTEGER NOT NULL)'
  );
}

async function ensureSeasonRatingQueueTable(rawDb: SQLiteDatabase) {
  await rawDb.runAsync(
    'CREATE TABLE IF NOT EXISTS season_rating_queue (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'season_id TEXT NOT NULL, ' +
      'anime_id TEXT NOT NULL, ' +
      'nota INTEGER NOT NULL, ' +
      'rated_at INTEGER NOT NULL, ' +
      "status TEXT NOT NULL DEFAULT 'pending', " +
      'created_at INTEGER NOT NULL, ' +
      'updated_at INTEGER NOT NULL, ' +
      'last_attempt_at INTEGER, ' +
      'last_failure_kind TEXT)'
  );

  await rawDb.runAsync(
    'CREATE INDEX IF NOT EXISTS season_rating_queue_status_created_at_idx ON season_rating_queue(status, created_at, id)'
  );
}

/** Executes the run migrations operation. */
export async function runMigrations(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const migrate = getDrizzleMigrator();
  await migrate(db, migrations);
  await Promise.all([
    ensureBridgeConfigLastChangelogId(rawDb),
    ensureSyncRuntimeStatusExecutionColumns(rawDb),
    ensureOperationLogRetentionIndex(rawDb),
    ensureAnimesGuardColumn(rawDb),
    ensurePendingRemoteChangesTable(rawDb),
    ensureSeasonRatingQueueTable(rawDb),
  ]);
  return db;
}

/** Executes the get bridge config snapshot operation. */
export async function getBridgeConfigSnapshot(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const [config] = await db
    .select()
    .from(schema.bridgeConfig)
    .orderBy(desc(schema.bridgeConfig.id))
    .limit(1);

  return config ?? null;
}

/** Executes the clear bridge config operation. */
export async function clearBridgeConfig(rawDb: SQLiteDatabase) {
  await withDeferredWrite(rawDb, async (db) => {
    await db.delete(schema.bridgeConfig);
  });
}

async function withQueuedWrite<T>(
  rawDb: SQLiteDatabase,
  runWrite: () => Promise<T>,
) {
  const queueKey = rawDb as object;
  const previousWrite = WRITE_QUEUE_BY_DATABASE.get(queueKey) ?? Promise.resolve();

  const nextWrite = previousWrite.catch(() => undefined).then(runWrite);

  WRITE_QUEUE_BY_DATABASE.set(queueKey, nextWrite.catch(() => undefined));

  return nextWrite;
}

/** Executes the with exclusive write operation. */
export async function withExclusiveWrite<T>(
  rawDb: SQLiteDatabase,
  task: (db: AppDatabase, tx: SQLiteDatabase) => Promise<T>,
) {
  return withQueuedWrite(rawDb, async () => {
    let result!: T;

    await rawDb.withExclusiveTransactionAsync(async (tx) => {
      result = await task(
        createDrizzleDb(tx),
        tx,
      );
    });

    return result;
  });
}

/**
 * Queues UI-facing writes on the shared connection while avoiding Expo's exclusive transaction path.
 * This keeps local `useLiveQuery` consumers responsive after anime mutations without sacrificing
 * per-database write ordering.
 */
export async function withDeferredWrite<T>(
  rawDb: SQLiteDatabase,
  task: (db: AppDatabase, tx: SQLiteDatabase) => Promise<T>,
) {
  return withQueuedWrite(rawDb, async () => {
    let result!: T;

    await rawDb.withTransactionAsync(async () => {
      result = await task(createDrizzleDb(rawDb), rawDb);
    });

    return result;
  });
}
