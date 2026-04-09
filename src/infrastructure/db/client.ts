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

export async function runMigrations(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const migrate = getDrizzleMigrator();
  await migrate(db, migrations);
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
  // Usa runAsync directo en lugar de withExclusiveTransactionAsync para evitar
  // "database is locked" cuando hay un live query reactivo activo sobre el mismo rawDb.
  // Un DELETE sobre una tabla pequeña es atómico en SQLite sin necesitar lock exclusivo.
  await rawDb.runAsync("DELETE FROM bridge_config");
}

export async function withExclusiveWrite<T>(
  rawDb: SQLiteDatabase,
  task: (db: AppDatabase, tx: SQLiteDatabase) => Promise<T>,
) {
  const queueKey = rawDb as object;
  const previousWrite = writeQueueByDatabase.get(queueKey) ?? Promise.resolve();

  const nextWrite = previousWrite.catch(() => undefined).then(async () => {
    let result!: T;

    await rawDb.withExclusiveTransactionAsync(async (tx) => {
      result = await task(
        createDrizzleDb(tx as SQLiteDatabase),
        tx as SQLiteDatabase,
      );
    });

    return result;
  });

  writeQueueByDatabase.set(queueKey, nextWrite.catch(() => undefined));

  return nextWrite;
}
