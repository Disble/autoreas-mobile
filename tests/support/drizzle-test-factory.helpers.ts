import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import type { DrizzleConfig } from 'drizzle-orm/utils';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { PositionalStatement } from './drizzle-test-factory.types';
import { getNativeHandle } from './sqlite-adapter.helpers';

/**
 * Builds the `drizzle-orm/sqlite-proxy` callback bound to one adapter's underlying
 * `node:sqlite` handle (design D3).
 *
 * The four `method` modes do NOT share one row shape, and the differences are silent when got
 * wrong -- nothing throws, columns simply read back as `undefined` and assertions pass against
 * empty data. Verified against `drizzle-orm/sqlite-proxy/session.js`:
 *
 * - `all`  (`:117`, `rows.map(mapResultRow)`)      -> array of positional rows
 * - `values` (`:169`, returned unchanged)          -> array of positional rows
 * - `get`  (`:143-157`, `const row = rows;`)       -> the positional row ITSELF, not wrapped
 * - `run`  (no row mapping)                        -> empty rows
 *
 * Rows come straight from `setReturnArrays(true)`, which yields positional arrays in select
 * order. Deriving order from column names instead would be lossy: drizzle emits repeated column
 * names on joins, and an object keyed by name collapses them.
 */
export function createSqliteProxyCallback(adapter: SQLiteDatabase): AsyncRemoteCallback {
  const native = getNativeHandle(adapter);

  return (sql, params, method) => {
    const statement = native.prepare(sql) as unknown as PositionalStatement;

    if (method === 'run') {
      statement.run(...params);
      return Promise.resolve({ rows: [] });
    }

    statement.setReturnArrays(true);

    if (method === 'get') {
      const row = statement.get(...params) as unknown[] | undefined;

      // `rows` IS the row for `get`. Wrapping it would give drizzle a row whose first column
      // is an array; an absent row must be `[]`, never `undefined`.
      return Promise.resolve({ rows: row ?? [] });
    }

    return Promise.resolve({ rows: statement.all(...params) });
  };
}

/**
 * Returns a `getDrizzleFactory()`-compatible factory bound to `drizzle-orm/sqlite-proxy`
 * (design D3). Mocking `getDrizzleFactory` to return this lets `createDrizzleDb(rawDb)` in
 * production code run unchanged against the test adapter -- `rawDb` is supplied by the caller
 * at call time, so no adapter instance needs to be captured up front.
 */
export function createTestDrizzleFactory() {
  return function testDrizzleFactory<TSchema extends Record<string, unknown>>(
    rawDb: SQLiteDatabase,
    config?: DrizzleConfig<TSchema>,
  ) {
    return drizzle(createSqliteProxyCallback(rawDb), config);
  };
}
