import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';
import {
  buildAppliedOperation,
  buildReconcileResponseBody,
} from '../../support/sync-fixtures.helpers';

// The ONLY production module mocked in this suite, and only to hand drizzle a node:sqlite
// handle instead of expo-sqlite. Everything else -- the write door, the transaction, the
// reconcile logic, the schema, the wire mapping, the bridgeClient singleton -- runs for real.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** One `operation_log` row as read back from the real database. */
interface StoredOperationRow {
  id: number;
  anime_id: string;
  status: string;
}

/** One `bridge_config` row, read back to assert cursor movement. */
interface StoredBridgeConfigRow {
  last_changelog_id: number | null;
}

/** Opens a migrated database wired to a paired bridge and one pending outbox operation. */
async function openPairedDatabase() {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
    0,
  );
  await adapter.runAsync(
    'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES (?, ?, ?, ?, ?, ?)',
    'anime-1',
    'Test Anime',
    0,
    4,
    1,
    1,
  );
  await adapter.runAsync(
    'INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
    'anime-1',
    'update',
    JSON.stringify({ episodesWatched: 4, lastWatchedAt: 1_700_000_000_000 }),
    'pending',
    1_700_000_000_000,
  );

  return adapter;
}

describe('outbox round trip against a real database and a faked wire', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('sends the pending operation to the bridge and marks it synced on a confirmed 202', async () => {
    const adapter = await openPairedDatabase();
    fakeBridge.queueResponse({
      status: 202,
      body: buildReconcileResponseBody({
        appliedOperations: [buildAppliedOperation({ anime_id: 'anime-1', operation: 'update' })],
        lastChangelogId: 41,
      }),
    });
    await syncPendingOperations(adapter);

    const operations = await adapter.getAllAsync<StoredOperationRow>(
      'SELECT id, anime_id, status FROM operation_log',
    );
    const config = await adapter.getFirstAsync<StoredBridgeConfigRow>(
      'SELECT last_changelog_id FROM bridge_config WHERE id = 1',
    );

    // The request actually reached the wire, carrying the queued operation.
    expect(fakeBridge.requests).toHaveLength(1);
    expect(fakeBridge.requests[0].method).toBe('POST');
    expect(fakeBridge.requests[0].url).toContain('192.168.0.10:8080');

    // And it left a durable footprint: the operation is confirmed and the cursor advanced.
    expect(operations).toEqual([
      { id: 1, anime_id: 'anime-1', status: 'synced' },
    ]);
    expect(config?.last_changelog_id).toBe(41);
  });

  it('leaves the operation unconfirmed when the bridge does not confirm it', async () => {
    const adapter = await openPairedDatabase();
    fakeBridge.queueResponse({
      status: 202,
      body: buildReconcileResponseBody({ appliedOperations: [], lastChangelogId: 41 }),
    });
    await syncPendingOperations(adapter);

    const operations = await adapter.getAllAsync<StoredOperationRow>(
      'SELECT id, anime_id, status FROM operation_log',
    );

    // An unconfirmed operation must never be marked synced -- that would lose the user's edit.
    expect(operations[0].status).not.toBe('synced');
  });
});
