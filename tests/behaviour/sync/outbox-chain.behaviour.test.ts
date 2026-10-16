import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';
import {
  buildAppliedOperation,
  buildReconcileResponseBody,
} from '../../support/sync-fixtures.helpers';
import type { AppliedOperationFixture } from '../../support/sync-fixtures.types';

// Same seam as `outbox-round-trip.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** One `operation_log` row with its claim columns. */
interface StoredRow {
  id: number;
  status: string;
  claim_owner: string | null;
  claimed_at: number | null;
}

/** The part of a recorded reconcile request body these tests read. */
interface SentReconcileBody {
  pending_operations: readonly { anime_id: string; base?: number }[];
}

/** Yields to the event loop until the fake bridge has received `count` requests. */
async function waitForRequestCount(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Opens a paired database holding two queued `anime-1` rows behind the stored token 7. */
async function openDatabaseWithTwoRows(): Promise<SQLiteDatabase> {
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
    'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'anime-1',
    'Test Anime',
    0,
    4,
    1,
    1,
    7,
  );

  for (const [createdAt, episodes] of [[1_700_000_000_000, 4], [1_700_000_000_001, 5]]) {
    await adapter.runAsync(
      'INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
      'anime-1',
      'update',
      JSON.stringify({ episodesWatched: episodes }),
      'pending',
      createdAt,
    );
  }

  return adapter;
}

/** A 202 carrying the given `applied_operations` for `anime-1`. */
function respondWith(entry: Partial<AppliedOperationFixture>) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: [buildAppliedOperation({ anime_id: 'anime-1', operation: 'update', ...entry })],
      lastChangelogId: 1,
    }),
  };
}

/** Reads both outbox rows back with their claim columns. */
function readRows(adapter: SQLiteDatabase): Promise<StoredRow[]> {
  return adapter.getAllAsync<StoredRow>(
    'SELECT id, status, claim_owner, claimed_at FROM operation_log ORDER BY id',
  );
}

/** Reads the stored token of `anime-1`. */
async function readToken(adapter: SQLiteDatabase): Promise<number | null> {
  const row = await adapter.getFirstAsync<{ bridge_modified_at: number | null }>(
    "SELECT bridge_modified_at FROM animes WHERE _id = 'anime-1'",
  );

  return row?.bridge_modified_at ?? null;
}

/** What the n-th recorded request carried as pending operations. */
function sentOperations(fakeBridge: FakeBridge, index: number) {
  return (fakeBridge.requests[index].body as SentReconcileBody).pending_operations;
}

/** A row back in the queue with no claim on it. */
const UNCLAIMED_PENDING = { status: 'pending', claim_owner: null, claimed_at: null };

describe('chained sends per key (ADR 009 R-14)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('sends the next row only after the previous one is confirmed, on the token it returned', async () => {
    const adapter = await openDatabaseWithTwoRows();
    fakeBridge.queueResponse(respondWith({ modified_at: 14 }));
    fakeBridge.queueResponse(respondWith({ modified_at: 15 }));

    await syncPendingOperations(adapter);

    expect(fakeBridge.requests).toHaveLength(2);
    expect(sentOperations(fakeBridge, 0)).toEqual([expect.objectContaining({ anime_id: 'anime-1', base: 7 })]);
    expect(sentOperations(fakeBridge, 1)).toEqual([expect.objectContaining({ anime_id: 'anime-1', base: 14 })]);
    expect((await readRows(adapter)).map((row) => row.status)).toEqual(['synced', 'synced']);
    await expect(readToken(adapter)).resolves.toBe(15);
  });

  it('stops the key on a rejection and leaves the row behind it pending and unclaimed', async () => {
    const adapter = await openDatabaseWithTwoRows();
    fakeBridge.queueResponse(respondWith({ applied: false, reason: 'conflict', modified_at: 9 }));

    await syncPendingOperations(adapter);

    expect(fakeBridge.requests).toHaveLength(1);
    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, ...UNCLAIMED_PENDING }),
      expect.objectContaining({ id: 2, ...UNCLAIMED_PENDING }),
    ]);
  });

  it('holds the rows behind a row that was given up, in this cycle and the next', async () => {
    const adapter = await openDatabaseWithTwoRows();
    fakeBridge.queueResponse(respondWith({ applied: false, reason: 'unsupported_operation' }));
    fakeBridge.queueResponse({
      status: 202,
      body: buildReconcileResponseBody({ appliedOperations: [], lastChangelogId: 1 }),
    });

    await syncPendingOperations(adapter);
    await syncPendingOperations(adapter);

    expect(fakeBridge.requests).toHaveLength(2);
    expect(sentOperations(fakeBridge, 1)).toEqual([]);
    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, status: 'dead_letter' }),
      expect.objectContaining({ id: 2, ...UNCLAIMED_PENDING }),
    ]);
  });

  it('stops on a network failure mid-chain: the unsent row stays pending, unclaimed and uncounted', async () => {
    const adapter = await openDatabaseWithTwoRows();
    fakeBridge.queueResponse(respondWith({ modified_at: 14 }));
    fakeBridge.queueResponse({ status: 500, body: { error: 'boom' } });

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    const rows = await adapter.getAllAsync<StoredRow & { conflict_attempt_count: number }>(
      'SELECT id, status, claim_owner, claimed_at, conflict_attempt_count FROM operation_log ORDER BY id',
    );
    expect(rows).toEqual([
      expect.objectContaining({ id: 1, status: 'synced' }),
      { id: 2, ...UNCLAIMED_PENDING, conflict_attempt_count: 0 },
    ]);
  });

  it('stops chaining after 20 s in one cycle and releases the row it did not send', async () => {
    const adapter = await openDatabaseWithTwoRows();
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    now += 21_000;
    held.release(respondWith({ modified_at: 14 }));
    await cycle;

    expect(fakeBridge.requests).toHaveLength(1);
    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, status: 'synced' }),
      expect.objectContaining({ id: 2, ...UNCLAIMED_PENDING }),
    ]);
  });

  it('never writes a token from a response for a key the other runtime took over', async () => {
    const adapter = await openDatabaseWithTwoRows();
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    // The claim expired mid-request; Kotlin confirmed the row and stored a newer token.
    await adapter.runAsync(
      "UPDATE operation_log SET status = 'synced', claim_owner = NULL, claimed_at = NULL WHERE id = 1",
    );
    await adapter.runAsync("UPDATE animes SET bridge_modified_at = 50 WHERE _id = 'anime-1'");
    held.release(respondWith({ modified_at: 14 }));
    await cycle;

    await expect(readToken(adapter)).resolves.toBe(50);
  });
});
