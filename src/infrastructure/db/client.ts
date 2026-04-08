import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { desc } from 'drizzle-orm';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import * as schema from './schema';
import migrations from './migrations/migrations';

export const DATABASE_NAME = 'autoreas.db';

export type AppDatabase = ReturnType<typeof createDrizzleDb>;

export function openAppDatabaseSync() {
  return openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });
}

export function createDrizzleDb(rawDb: SQLiteDatabase) {
  return drizzle(rawDb, { schema });
}

export async function runMigrations(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
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

export async function withExclusiveWrite<T>(
  rawDb: SQLiteDatabase,
  task: (db: AppDatabase, tx: SQLiteDatabase) => Promise<T>
) {
  let result!: T;

  await rawDb.withExclusiveTransactionAsync(async (tx) => {
    result = await task(createDrizzleDb(tx as SQLiteDatabase), tx as SQLiteDatabase);
  });

  return result;
}

export async function insertDummyAnime(rawDb: SQLiteDatabase) {
  const dummyAnime: schema.NewAnime = {
    _id: `dummy-${Date.now()}`,
    nombre: 'Anime de prueba',
    estado: 0,
    nrocapvisto: 0,
    activo: 1,
    primeravez: 1,
  };

  await withExclusiveWrite(rawDb, async (db) => {
    await db.insert(schema.animes).values(dummyAnime);
  });

  return dummyAnime;
}

export async function countAnimes(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);
  const rows = await db.select().from(schema.animes);

  return rows.length;
}
