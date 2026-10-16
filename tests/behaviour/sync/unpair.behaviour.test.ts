import type { SQLiteDatabase } from 'expo-sqlite';
import { clearBridgeConfig } from '../../../src/infrastructure/db/client/client.helpers';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// Same seam as `outbox-claims.behaviour.test.ts`: only the drizzle factory is swapped for a
// node:sqlite one; the write door and the unpair SQL run for real.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** Opens a migrated database paired to a bridge, with one anime and an entry in every queue. */
async function openPairedDatabase(): Promise<SQLiteDatabase> {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
    120,
  );
  await adapter.runAsync(
    'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'anime-1',
    'Test Anime',
    0,
    4,
    1,
    0,
    7,
  );
  for (const status of ['pending', 'synced', 'dead_letter']) {
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-1', 'update', '{}', ?, 1)",
      status,
    );
  }
  await adapter.runAsync(
    "INSERT INTO season_rating_queue (season_id, anime_id, nota, rated_at, created_at, updated_at) VALUES ('season-1', 'anime-1', 3, 1, 1, 1)",
  );
  await adapter.runAsync(
    "INSERT INTO pending_remote_changes (record_id, change_type, changed_fields, timestamp, created_at) VALUES ('anime-1', 'update', '[]', 1, 1)",
  );
  return adapter;
}

/** Counts the rows of one table in the real database. */
async function countRows(adapter: SQLiteDatabase, table: string): Promise<number> {
  const row = await adapter.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row?.count ?? 0);
}

describe('unpairing a bridge (ADR 009 R-11)', () => {
  it('clears the bridge tokens and every queue that belongs to the old pairing', async () => {
    const adapter = await openPairedDatabase();

    await clearBridgeConfig(adapter);

    expect(await countRows(adapter, 'bridge_config')).toBe(0);
    expect(await countRows(adapter, 'operation_log')).toBe(0);
    expect(await countRows(adapter, 'season_rating_queue')).toBe(0);
    expect(await countRows(adapter, 'pending_remote_changes')).toBe(0);
    expect(await adapter.getAllAsync('SELECT _id, nrocapvisto, bridge_modified_at FROM animes')).toEqual([
      { _id: 'anime-1', nrocapvisto: 4, bridge_modified_at: null },
    ]);
  });
});
