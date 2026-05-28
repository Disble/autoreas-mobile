import { desc } from "drizzle-orm";
import type { SQLiteDatabase } from "expo-sqlite";
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

export function openAppDatabaseSync() {
  const openDatabaseSync = getOpenDatabaseSync();
  return openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });
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
    "UPDATE bridge_config SET last_changelog_id = 0 WHERE last_changelog_id IS NULL OR typeof(last_changelog_id) NOT IN ('integer', 'real') OR last_changelog_id < 0"
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
}

export async function runMigrations(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const migrate = getDrizzleMigrator();
  await migrate(db, migrations);
  await ensureBridgeConfigLastChangelogId(rawDb);
  await ensureSyncRuntimeStatusExecutionColumns(rawDb);
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
