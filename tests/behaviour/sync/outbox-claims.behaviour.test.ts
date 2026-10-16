import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';
import {
  buildAppliedOperation,
  buildReconcileResponseBody,
} from '../../support/sync-fixtures.helpers';

// Same seam as `outbox-round-trip.behaviour.test.ts`: only the drizzle factory is swapped for a
// node:sqlite one; the write door, the claim SQL and the reconcile flow run for real.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** One `operation_log` row with its claim columns, as read back from the real database. */
interface StoredClaimRow {
  status: string;
  claim_owner: string | null;
  claimed_at: number | null;
}

/** The part of a recorded reconcile request body these tests read. */
interface SentReconcileBody {
  pending_operations: readonly { anime_id: string }[];
}

/** Yields to the event loop until the fake bridge has received `count` requests. */
async function waitForRequestCount(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Opens a migrated, paired database holding one `anime-1` outbox row in the given claim state. */
async function openDatabaseWithRow(row: StoredClaimRow): Promise<SQLiteDatabase> {
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
    'INSERT INTO operation_log (anime_id, operation, payload, status, created_at, claim_owner, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'anime-1',
    'update',
    JSON.stringify({ episodesWatched: 4 }),
    row.status,
    1_700_000_000_000,
    row.claim_owner,
    row.claimed_at,
  );

  return adapter;
}

/** Reads the single outbox row back with its claim columns. */
function readRow(adapter: SQLiteDatabase): Promise<StoredClaimRow | null> {
  return adapter.getFirstAsync<StoredClaimRow>(
    'SELECT status, claim_owner, claimed_at FROM operation_log WHERE id = 1',
  );
}

/** The anime ids the n-th recorded request carried as pending operations. */
function sentAnimeIds(fakeBridge: FakeBridge, index: number): string[] {
  const body = fakeBridge.requests[index].body as SentReconcileBody;

  return body.pending_operations.map((operation) => operation.anime_id);
}

/** Queues one more `pending` outbox row, for `animeId`, behind the rows already there. */
async function queueRow(adapter: SQLiteDatabase, animeId: string, createdAt: number): Promise<void> {
  await adapter.runAsync(
    'INSERT OR IGNORE INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES (?, ?, ?, ?, ?, ?)',
    animeId,
    'Test Anime',
    0,
    4,
    1,
    1,
  );
  await adapter.runAsync(
    'INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, ?, ?, ?, ?)',
    animeId,
    'update',
    JSON.stringify({ episodesWatched: 5 }),
    'pending',
    createdAt,
  );
}

/** Reads every outbox row back with its claim columns and attempt count, by id. */
function readRows(adapter: SQLiteDatabase) {
  return adapter.getAllAsync<StoredClaimRow & { id: number; conflict_attempt_count: number }>(
    'SELECT id, status, claim_owner, claimed_at, conflict_attempt_count FROM operation_log ORDER BY id',
  );
}

/** Lets the other runtime take the `anime-2` row over, as after this runtime's claim expired. */
function takeOverAnime2(adapter: SQLiteDatabase, claimedAt: number) {
  return adapter.runAsync(
    "UPDATE operation_log SET claim_owner = 'native', claimed_at = ? WHERE anime_id = 'anime-2'",
    claimedAt,
  );
}

/** A 202 that confirms the `anime-1` update. */
const CONFIRMING_RESPONSE = {
  status: 202,
  body: buildReconcileResponseBody({
    appliedOperations: [buildAppliedOperation({ anime_id: 'anime-1', operation: 'update' })],
    lastChangelogId: 1,
  }),
};

describe('per-key outbox claims between the two runtimes (ADR 009 R-13)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('skips a key the other runtime holds with a live claim, without touching the row', async () => {
    const liveNativeClaim = {
      status: 'processing',
      claim_owner: 'native',
      claimed_at: Date.now() - 10_000,
    };
    const adapter = await openDatabaseWithRow(liveNativeClaim);
    fakeBridge.queueResponse({
      status: 202,
      body: buildReconcileResponseBody({ appliedOperations: [], lastChangelogId: 1 }),
    });

    await syncPendingOperations(adapter);

    expect(sentAnimeIds(fakeBridge, 0)).toEqual([]);
    await expect(readRow(adapter)).resolves.toEqual(liveNativeClaim);
  });

  it('takes a key whose claim expired after 60 s and releases it once confirmed', async () => {
    const adapter = await openDatabaseWithRow({
      status: 'processing',
      claim_owner: 'native',
      claimed_at: Date.now() - 61_000,
    });
    fakeBridge.queueResponse(CONFIRMING_RESPONSE);

    await syncPendingOperations(adapter);

    expect(sentAnimeIds(fakeBridge, 0)).toEqual(['anime-1']);
    await expect(readRow(adapter)).resolves.toEqual({
      status: 'synced',
      claim_owner: null,
      claimed_at: null,
    });
  });

  it('records its own claim, owner and time, while the request is in flight', async () => {
    const adapter = await openDatabaseWithRow({ status: 'pending', claim_owner: null, claimed_at: null });
    const held = fakeBridge.queueDeferredResponse();
    const before = Date.now();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    const inFlight = await readRow(adapter);
    held.release(CONFIRMING_RESPONSE);
    await cycle;

    expect(inFlight?.status).toBe('processing');
    expect(inFlight?.claim_owner).toBe('js');
    expect(inFlight?.claimed_at).toBeGreaterThanOrEqual(before);
  });

  it('never reverts a row the other runtime confirmed after this claim was lost', async () => {
    const adapter = await openDatabaseWithRow({ status: 'pending', claim_owner: null, claimed_at: null });
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    // The claim expired mid-request; Kotlin took the key and confirmed the row.
    await adapter.runAsync(
      "UPDATE operation_log SET status = 'synced', claim_owner = NULL, claimed_at = NULL WHERE id = 1",
    );
    held.release({
      status: 202,
      body: buildReconcileResponseBody({ appliedOperations: [], lastChangelogId: 1 }),
    });
    await cycle;

    await expect(readRow(adapter)).resolves.toEqual({
      status: 'synced',
      claim_owner: null,
      claimed_at: null,
    });
  });

  it('never reverts a confirmed row when its own request then fails', async () => {
    const adapter = await openDatabaseWithRow({ status: 'pending', claim_owner: null, claimed_at: null });
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    await adapter.runAsync(
      "UPDATE operation_log SET status = 'synced', claim_owner = NULL, claimed_at = NULL WHERE id = 1",
    );
    held.release({ status: 500, body: { error: 'boom' } });
    await expect(cycle).rejects.toThrow();

    await expect(readRow(adapter)).resolves.toEqual({
      status: 'synced',
      claim_owner: null,
      claimed_at: null,
    });
  });

  it('releases its claim when the request fails, leaving the row pending', async () => {
    const adapter = await openDatabaseWithRow({ status: 'pending', claim_owner: null, claimed_at: null });
    fakeBridge.queueResponse({ status: 500, body: { error: 'boom' } });

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    await expect(readRow(adapter)).resolves.toEqual({
      status: 'pending',
      claim_owner: null,
      claimed_at: null,
    });
  });

  // Regression tests from the T4 independent verification (probes P1-P4).

  it('still sends every other key while one key is held by the other runtime', async () => {
    const adapter = await openDatabaseWithRow({
      status: 'processing',
      claim_owner: 'native',
      claimed_at: Date.now() - 10_000,
    });
    await queueRow(adapter, 'anime-2', 1_700_000_000_005);
    fakeBridge.queueResponse({
      status: 202,
      body: buildReconcileResponseBody({ appliedOperations: [], lastChangelogId: 1 }),
    });

    await syncPendingOperations(adapter);

    expect(sentAnimeIds(fakeBridge, 0)).toEqual(['anime-2']);
  });

  it('never sends a newer row of a key the other runtime holds', async () => {
    const adapter = await openDatabaseWithRow({
      status: 'processing',
      claim_owner: 'native',
      claimed_at: Date.now() - 10_000,
    });
    await queueRow(adapter, 'anime-1', 1_700_000_000_005);
    fakeBridge.queueResponse({
      status: 202,
      body: buildReconcileResponseBody({ appliedOperations: [], lastChangelogId: 1 }),
    });

    await syncPendingOperations(adapter);

    expect(sentAnimeIds(fakeBridge, 0)).toEqual([]);
    expect((await readRows(adapter))[1]).toEqual(
      expect.objectContaining({ id: 2, status: 'pending', claim_owner: null, claimed_at: null }),
    );
  });

  it('dead-letters only the rows it still holds when the bridge rejects the batch', async () => {
    const adapter = await openDatabaseWithRow({ status: 'pending', claim_owner: null, claimed_at: null });
    await queueRow(adapter, 'anime-2', 1_700_000_000_005);
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    const takenOverAt = Date.now();
    await takeOverAnime2(adapter, takenOverAt);
    held.release({ status: 400, body: { error: 'bad batch' } });
    await expect(cycle).rejects.toThrow();

    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, status: 'dead_letter', claim_owner: null, claimed_at: null }),
      expect.objectContaining({ id: 2, status: 'processing', claim_owner: 'native', claimed_at: takenOverAt }),
    ]);
  });

  it('leaves a taken-over row untouched by a conflict for it: status, claim and count', async () => {
    const adapter = await openDatabaseWithRow({ status: 'pending', claim_owner: null, claimed_at: null });
    await queueRow(adapter, 'anime-2', 1_700_000_000_005);
    const held = fakeBridge.queueDeferredResponse();
    const cycle = syncPendingOperations(adapter);
    await waitForRequestCount(fakeBridge, 1);

    const takenOverAt = Date.now();
    await takeOverAnime2(adapter, takenOverAt);
    held.release({
      status: 202,
      body: buildReconcileResponseBody({
        appliedOperations: [
          buildAppliedOperation({ anime_id: 'anime-2', operation: 'update', applied: false, reason: 'conflict', modified_at: 999 }),
        ],
        lastChangelogId: 1,
      }),
    });
    await cycle;

    expect((await readRows(adapter))[1]).toEqual({
      id: 2,
      status: 'processing',
      claim_owner: 'native',
      claimed_at: takenOverAt,
      conflict_attempt_count: 0,
    });
  });
});
