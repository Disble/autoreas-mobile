import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';
import {
  IMPLEMENTED_MEMBERS,
  MIGRATIONS_DIR,
  NATIVE_BY_ADAPTER,
  PROBE_MEMBERS,
} from './sqlite-adapter.constants';

/**
 * Normalizes the trailing bind-parameter arguments of an `SQLiteDatabase` call into the
 * argument list `node:sqlite`'s prepared-statement `run`/`get`/`all` expect: a single array
 * argument is flattened to positional values, everything else is passed through unchanged.
 */
function toStatementArgs(args: readonly unknown[]): SQLInputValue[] {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0] as SQLInputValue[];
  }

  return [...args] as SQLInputValue[];
}

/**
 * Builds one `node:sqlite`-backed `SQLiteDatabase` implementation (design D2). Only the six
 * members the app actually calls are implemented; a `Proxy` throws on any other
 * `SQLiteDatabase`-shaped property access instead of silently returning `undefined`.
 */
export function createTestSqliteAdapter(): SQLiteDatabase {
  const native = new DatabaseSync(':memory:');
  const databasePath = `test-db-${randomUUID()}`;

  const implementation = {
    databasePath,
    execAsync(source: string): Promise<void> {
      native.exec(source);
      return Promise.resolve();
    },
    execSync(source: string): void {
      native.exec(source);
    },
    runAsync(source: string, ...args: unknown[]): Promise<SQLiteRunResult> {
      const result = native.prepare(source).run(...toStatementArgs(args));

      return Promise.resolve({
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      });
    },
    getAllAsync<T>(source: string, ...args: unknown[]): Promise<T[]> {
      return Promise.resolve(native.prepare(source).all(...toStatementArgs(args)) as T[]);
    },
    getFirstAsync<T>(source: string, ...args: unknown[]): Promise<T | null> {
      const row = native.prepare(source).get(...toStatementArgs(args));

      return Promise.resolve((row ?? null) as T | null);
    },
  };

  const adapter = new Proxy(implementation, {
    get(target, property, receiver) {
      if (
        typeof property === 'string' &&
        !IMPLEMENTED_MEMBERS.has(property) &&
        !PROBE_MEMBERS.has(property)
      ) {
        throw new Error(
          `tests/support/sqlite-adapter: "${property}" is not implemented on the test ` +
            'SQLiteDatabase adapter (design D2 -- only databasePath, execAsync, execSync, ' +
            'runAsync, getAllAsync and getFirstAsync exist).',
        );
      }

      return Reflect.get(target, property, receiver);
    },
  }) as unknown as SQLiteDatabase;

  NATIVE_BY_ADAPTER.set(adapter, native);

  return adapter;
}

/**
 * Returns the raw `node:sqlite` handle behind a test adapter. The drizzle proxy needs it
 * because it requires positional rows via `setReturnArrays`, while the adapter deliberately
 * keeps expo-sqlite's object-returning contract for the app's own `rawDb` calls.
 */
export function getNativeHandle(adapter: SQLiteDatabase): DatabaseSync {
  const native = NATIVE_BY_ADAPTER.get(adapter);

  if (!native) {
    throw new Error(
      'tests/support/sqlite-adapter: adapter was not created by createTestSqliteAdapter',
    );
  }

  return native;
}

/**
 * Applies every production migration file, in filename order, to a fresh test adapter.
 * Reads the same SQL the app ships instead of a hand-written fixture, so DDL drift between
 * the harness and production is impossible by construction.
 *
 * This is only HALF of the production schema. `sync_cycle_lock` and `active_season_cache` are
 * created imperatively by `prepareDatabaseSchema`'s `ensure*` steps and exist in no migration
 * file, so a behaviour test needing them must run the app's own `runMigrations` as well.
 */
export async function applyMigrationFiles(adapter: SQLiteDatabase): Promise<void> {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    await adapter.execAsync(sql);
  }
}
