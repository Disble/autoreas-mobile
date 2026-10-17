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
  anime_id: string;
  status: string;
  claim_owner: string | null;
  claimed_at: number | null;
}

/** The part of a recorded reconcile request body these tests read. */
interface SentReconcileBody {
  last_changelog_id: number;
  pending_operations: readonly { anime_id: string; base?: number }[];
}

/** Yields to the event loop until the fake bridge has received `count` requests. */
async function waitForRequestCount(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Opens a paired database; each anime is stored at its token, with no queued row yet. */
async function openDatabase(tokens: Readonly<Record<string, number>>): Promise<SQLiteDatabase> {
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

  for (const [animeId, token] of Object.entries(tokens)) {
    await adapter.runAsync(
      'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      animeId,
      'Test Anime',
      0,
      4,
      1,
      1,
      token,
    );
  }

  return adapter;
}

/** The `created_at` of the last queued row; each new row lands one millisecond later. */
let nextCreatedAt = 1_700_000_000_000;

/** Queues one update row for `animeId` (default `pending`); rows land in call order. */
function queueRow(adapter: SQLiteDatabase, animeId: string, status = 'pending') {
  nextCreatedAt += 1;

  return adapter.runAsync(
    'INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
    animeId,
    'update',
    JSON.stringify({ episodesWatched: 5 }),
    status,
    nextCreatedAt,
  );
}

/** A 202 carrying `entries` and the given cursor. */
function respond(entries: readonly Partial<AppliedOperationFixture>[], lastChangelogId: number) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: entries.map((entry) => buildAppliedOperation({ operation: 'update', ...entry })),
      lastChangelogId,
    }),
  };
}

/** Reads every outbox row back with its claim columns. */
function readRows(adapter: SQLiteDatabase): Promise<StoredRow[]> {
  return adapter.getAllAsync<StoredRow>(
    'SELECT id, anime_id, status, claim_owner, claimed_at FROM operation_log ORDER BY id',
  );
}

/** Every recorded reconcile request body, in send order. */
function sentBodies(fakeBridge: FakeBridge): SentReconcileBody[] {
  return fakeBridge.requests.map((request) => request.body as SentReconcileBody);
}

/** Leaves a row back in the queue with no claim on it. */
const UNCLAIMED_PENDING = { status: 'pending', claim_owner: null, claimed_at: null };

// Regression tests from the T6 independent verification (probes V1-V8).
describe('chained sends per key, edge cases (ADR 009 R-14)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('chains one key on while another key is rejected and stops', async () => {
    const adapter = await openDatabase({ 'anime-a': 7, 'anime-b': 3 });
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-b');
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-b');
    fakeBridge.queueResponse(
      respond(
        [
          { anime_id: 'anime-a', applied: false, reason: 'conflict', modified_at: 9 },
          { anime_id: 'anime-b', modified_at: 4 },
        ],
        5,
      ),
    );
    fakeBridge.queueResponse(respond([{ anime_id: 'anime-b', modified_at: 6 }], 6));

    await syncPendingOperations(adapter);

    const bodies = sentBodies(fakeBridge);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(
      expect.objectContaining({
        last_changelog_id: 5,
        pending_operations: [expect.objectContaining({ anime_id: 'anime-b', base: 4 })],
      }),
    );
    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, ...UNCLAIMED_PENDING }),
      expect.objectContaining({ id: 2, status: 'synced' }),
      expect.objectContaining({ id: 3, ...UNCLAIMED_PENDING }),
      expect.objectContaining({ id: 4, status: 'synced' }),
    ]);
  });

  it('chains three rows, each on the previous token and cursor', async () => {
    const adapter = await openDatabase({ 'anime-a': 7 });
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-a');
    fakeBridge.queueResponse(respond([{ anime_id: 'anime-a', modified_at: 14 }], 1));
    fakeBridge.queueResponse(respond([{ anime_id: 'anime-a', modified_at: 15 }], 2));
    fakeBridge.queueResponse(respond([{ anime_id: 'anime-a', modified_at: 16 }], 3));

    const result = await syncPendingOperations(adapter);

    const bodies = sentBodies(fakeBridge);
    expect(bodies.map((body) => body.last_changelog_id)).toEqual([0, 1, 2]);
    expect(bodies.map((body) => body.pending_operations[0].base)).toEqual([7, 14, 15]);
    expect(result).toEqual(expect.objectContaining({ syncedCount: 3, hasMorePending: false }));
    expect((await readRows(adapter)).map((row) => row.status)).toEqual(['synced', 'synced', 'synced']);
  });

  it('chains a row the user queued while the previous one was in flight', async () => {
    const adapter = await openDatabase({ 'anime-a': 7 });
    await queueRow(adapter, 'anime-a');
    const held = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(respond([{ anime_id: 'anime-a', modified_at: 15 }], 2));
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    await queueRow(adapter, 'anime-a');
    held.release(respond([{ anime_id: 'anime-a', modified_at: 14 }], 1));
    await cycle;

    expect(sentBodies(fakeBridge)[1].pending_operations).toEqual([
      expect.objectContaining({ anime_id: 'anime-a', base: 14 }),
    ]);
    expect((await readRows(adapter)).map((row) => row.status)).toEqual(['synced', 'synced']);
  });

  it('keeps round 1 synced, dead-letters round 2 and sends the next row next cycle on a 400', async () => {
    const adapter = await openDatabase({ 'anime-a': 7 });
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-a');
    fakeBridge.queueResponse(respond([{ anime_id: 'anime-a', modified_at: 14 }], 1));
    fakeBridge.queueResponse({ status: 400, body: { error: 'bad operation' } });
    fakeBridge.queueResponse(respond([], 1));

    await expect(syncPendingOperations(adapter)).rejects.toThrow();
    await syncPendingOperations(adapter);

    expect(sentBodies(fakeBridge)[2].pending_operations).toEqual([
      expect.objectContaining({ anime_id: 'anime-a', base: 14 }),
    ]);
    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, status: 'synced' }),
      expect.objectContaining({ id: 2, status: 'dead_letter', claim_owner: null }),
      expect.objectContaining({ id: 3, ...UNCLAIMED_PENDING }),
    ]);
  });

  it('claims no successor of any key once the budget is spent', async () => {
    const adapter = await openDatabase({ 'anime-a': 7, 'anime-b': 3 });
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-b');
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-b');
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    now += 20_000;
    held.release(respond([{ anime_id: 'anime-a', modified_at: 14 }, { anime_id: 'anime-b', modified_at: 4 }], 1));
    await cycle;

    expect(fakeBridge.requests).toHaveLength(1);
    expect((await readRows(adapter)).slice(2)).toEqual([
      expect.objectContaining({ id: 3, ...UNCLAIMED_PENDING }),
      expect.objectContaining({ id: 4, ...UNCLAIMED_PENDING }),
    ]);
  });

  it('never claims a successor the other runtime holds with a live claim', async () => {
    const adapter = await openDatabase({ 'anime-a': 7 });
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-a', 'processing');
    const liveClaim = Date.now() - 5_000;
    await adapter.runAsync(
      "UPDATE operation_log SET claim_owner = 'native', claimed_at = ? WHERE id = 2",
      liveClaim,
    );
    fakeBridge.queueResponse(respond([{ anime_id: 'anime-a', modified_at: 14 }], 1));

    await syncPendingOperations(adapter);

    // The live claim on row 2 holds the whole key, so row 1 is not sent either.
    expect(sentBodies(fakeBridge)[0].pending_operations).toEqual([]);
    expect((await readRows(adapter))[1]).toEqual(
      expect.objectContaining({ id: 2, status: 'processing', claim_owner: 'native', claimed_at: liveClaim }),
    );
  });

  it('neither counts nor chains a confirmation for a row the other runtime took over', async () => {
    const adapter = await openDatabase({ 'anime-a': 7 });
    await queueRow(adapter, 'anime-a');
    await queueRow(adapter, 'anime-a');
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    await adapter.runAsync(
      "UPDATE operation_log SET status = 'synced', claim_owner = NULL, claimed_at = NULL WHERE id = 1",
    );
    held.release(respond([{ anime_id: 'anime-a', modified_at: 14 }], 1));
    const result = await cycle;

    expect(result.syncedCount).toBe(0);
    expect(fakeBridge.requests).toHaveLength(1);
    expect((await readRows(adapter))[1]).toEqual(expect.objectContaining({ id: 2, ...UNCLAIMED_PENDING }));
  });
});
