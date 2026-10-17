import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator';
import type { SQLiteDatabase } from 'expo-sqlite';
import journal from '../../src/infrastructure/db/migrations/meta/_journal.json';
import {
  ACTIVE_SEASON_CACHE_TABLE_SQL,
  MIGRATION_LEDGER_CREATE_SQL,
  MIGRATION_LEDGER_SEED_SQL,
} from '../../src/infrastructure/db/client/client.constants';
import { APP_PREFERENCES_TABLE_SQL, SYNC_CYCLE_LOCK_TABLE_SQL } from '../../src/infrastructure/db/startup/startup.constants';
import { createTestDrizzleFactory } from './drizzle-test-factory.helpers';
import {
  CRASHING_PROXY_TARGETS,
  GATE_MIGRATOR_LOG,
  V1_12_0_LAST_MIGRATION,
  V1_12_0_READINESS_VERSION,
} from './migration-gate.constants';
import type { DatabaseDump, MigratorDatabase, SchemaEntry } from './migration-gate.types';
import { MIGRATIONS_DIR } from './sqlite-adapter.constants';
import { applyMigrationFiles, createTestSqliteAdapter } from './sqlite-adapter.helpers';

/**
 * Builds a `getDrizzleMigrator()`-compatible migrator over drizzle's REAL single-scalar gate
 * (`drizzle-orm/sqlite-proxy/migrator`): it compares `MAX(created_at)` of `__drizzle_migrations`
 * with each shipped migration's `when`, exactly as the app's expo migrator does, and runs what it
 * selects in one transaction. Each batch is logged in `GATE_MIGRATOR_LOG`.
 */
export function createGateMigrator() {
  return async (db: MigratorDatabase): Promise<void> => {
    await migrate(
      db as never,
      async (queries: string[]) => {
        GATE_MIGRATOR_LOG.push(queries);

        if (queries.length === 0) {
          return;
        }

        await db.run(sql.raw('BEGIN'));
        try {
          for (const query of queries) {
            await db.run(sql.raw(query));
          }
          await db.run(sql.raw('COMMIT'));
        } catch (error) {
          await db.run(sql.raw('ROLLBACK'));
          throw error;
        }
      },
      { migrationsFolder: MIGRATIONS_DIR },
    );
  };
}

/** A `getDrizzleFactory()`-compatible factory that sees through `createCrashingAdapter` proxies. */
export function createUnwrappingDrizzleFactory() {
  const factory = createTestDrizzleFactory();

  return (rawDb: SQLiteDatabase, config?: unknown) => factory(CRASHING_PROXY_TARGETS.get(rawDb) ?? rawDb, config as never);
}

/** Wraps `adapter` so every `runAsync` / `execAsync` whose SQL `fails` rejects, like a dying process. */
export function createCrashingAdapter(adapter: SQLiteDatabase, fails: (source: string) => boolean): SQLiteDatabase {
  const proxy = new Proxy(adapter, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);

      if (property !== 'runAsync' && property !== 'execAsync') {
        return typeof member === 'function' ? member.bind(target) : member;
      }

      return (source: string, ...args: unknown[]) =>
        fails(source)
          ? Promise.reject(new Error(`injected failure at: ${source.slice(0, 40)}`))
          : (member as (statement: string, ...rest: unknown[]) => Promise<unknown>).call(target, source, ...args);
    },
  });
  CRASHING_PROXY_TARGETS.set(proxy, adapter);

  return proxy;
}

/**
 * Builds the database a device on v1.12.0 holds, from the shipped migration files alone: 0000-0017,
 * the repair-only tables, the ledger as `reconcileMigrationLedger` leaves it (one row per migration,
 * every one pinned to 0017's `when`) and readiness 18. No git history or old source is read.
 */
export async function openV1120Device(): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter, { through: V1_12_0_LAST_MIGRATION });

  for (const tableSql of [ACTIVE_SEASON_CACHE_TABLE_SQL, SYNC_CYCLE_LOCK_TABLE_SQL, APP_PREFERENCES_TABLE_SQL]) {
    await adapter.execAsync(tableSql);
  }

  const shipped = journal.entries.filter((entry) => entry.tag.slice(0, 4) <= V1_12_0_LAST_MIGRATION);
  const pinnedAt = Math.max(...shipped.map((entry) => entry.when));
  await adapter.execAsync(MIGRATION_LEDGER_CREATE_SQL);
  await shipped.reduce(
    (previous) => previous.then(() => adapter.runAsync(MIGRATION_LEDGER_SEED_SQL, '', pinnedAt)).then(() => undefined),
    Promise.resolve(),
  );
  await adapter.execAsync(`PRAGMA user_version = ${V1_12_0_READINESS_VERSION}`);

  return adapter;
}

/** Dumps the whole database: schema without `sqlite_sequence`, and every table's rows by rowid. */
export async function dumpDatabase(adapter: SQLiteDatabase): Promise<DatabaseDump> {
  const schema = await adapter.getAllAsync<SchemaEntry>(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name <> 'sqlite_sequence' ORDER BY type, name",
  );
  const tables: Record<string, unknown[]> = {};

  for (const entry of schema.filter((candidate) => candidate.type === 'table')) {
    tables[entry.name] = await adapter.getAllAsync(`SELECT * FROM "${entry.name}" ORDER BY rowid`);
  }

  return { schema, tables };
}

/** Reads `adapter.getFirstAsync('PRAGMA user_version')`. */
export async function readUserVersion(adapter: SQLiteDatabase): Promise<number> {
  const row = await adapter.getFirstAsync<{ user_version: number }>('PRAGMA user_version');

  return Number(row?.user_version);
}
