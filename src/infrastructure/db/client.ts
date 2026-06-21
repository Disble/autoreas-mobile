import { desc } from "drizzle-orm";
import type { SQLiteDatabase, SQLiteOpenOptions } from "expo-sqlite";
import migrations from "./migrations/migrations";
import {
  getDrizzleFactory,
  getDrizzleMigrator,
  getOpenDatabaseSync,
} from "./native-runtime";
import * as schema from "./schema";

export const DATABASE_NAME = "autoreas.db";
const writeQueueByDatabase = new WeakMap<object, Promise<unknown>>();

export type AppDatabase = ReturnType<typeof createDrizzleDb>;

/**
 * Defines the supported SQLite open overrides for callers that need explicit connection ownership.
 */
export interface OpenAppDatabaseSyncParams {
  readonly enableChangeListener?: SQLiteOpenOptions['enableChangeListener'];
  readonly useNewConnection?: SQLiteOpenOptions['useNewConnection'];
}

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

  if (!columnNames.has('execution_mode')) {
    await rawDb.runAsync(
      "ALTER TABLE sync_runtime_status ADD COLUMN execution_mode TEXT DEFAULT 'best_effort_background_task' NOT NULL"
    );
  }

  if (!columnNames.has('is_foreground_service_running')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN is_foreground_service_running INTEGER DEFAULT 0 NOT NULL'
    );
  }

  if (!columnNames.has('can_show_persistent_notification')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN can_show_persistent_notification INTEGER DEFAULT 0 NOT NULL'
    );
  }

  if (!columnNames.has('foreground_service_callback_started_at')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN foreground_service_callback_started_at INTEGER'
    );
  }

  if (!columnNames.has('last_no_op_reason')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_no_op_reason TEXT'
    );
  }

  if (!columnNames.has('last_pending_operations_count_at_start')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_pending_operations_count_at_start INTEGER'
    );
  }

  if (!columnNames.has('is_cycle_active')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN is_cycle_active INTEGER DEFAULT 0 NOT NULL'
    );
  }

  if (!columnNames.has('last_backlog_read_count')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_backlog_read_count INTEGER DEFAULT 0 NOT NULL'
    );
  }

  if (!columnNames.has('last_pruned_operations_count')) {
    await rawDb.runAsync(
      'ALTER TABLE sync_runtime_status ADD COLUMN last_pruned_operations_count INTEGER DEFAULT 0 NOT NULL'
    );
  }
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
  ]);
  return db;
}

export async function getBridgeConfigSnapshot(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const [config] = await db
    .select()
    .from(schema.bridgeConfig)
    .orderBy(desc(schema.bridgeConfig.id))
    .limit(1);

  return config ?? null;
}

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
  const previousWrite = writeQueueByDatabase.get(queueKey) ?? Promise.resolve();

  const nextWrite = previousWrite.catch(() => undefined).then(runWrite);

  writeQueueByDatabase.set(queueKey, nextWrite.catch(() => undefined));

  return nextWrite;
}

export async function withExclusiveWrite<T>(
  rawDb: SQLiteDatabase,
  task: (db: AppDatabase, tx: SQLiteDatabase) => Promise<T>,
) {
  return withQueuedWrite(rawDb, async () => {
    let result!: T;

    await rawDb.withExclusiveTransactionAsync(async (tx) => {
      result = await task(
        createDrizzleDb(tx as SQLiteDatabase),
        tx as SQLiteDatabase,
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
