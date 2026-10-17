import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { clearBridgeConfig } from '../../../src/infrastructure/db/client/client.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';
import {
  buildAppliedOperation,
  buildReconcileResponseBody,
} from '../../support/sync-fixtures.helpers';

// Same seam as `outbox-chain.behaviour.test.ts`: only the drizzle factory is swapped.
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
interface StoredRow {
  id: number;
  status: string;
  claim_owner: string | null;
  claimed_at: number | null;
  unresolved_reason: string | null;
}

/** The part of a recorded reconcile request body these tests read. */
interface SentReconcileBody {
  pending_operations: readonly { anime_id: string; base?: number }[];
}

// Seeds and readers copied from `fetch-first.behaviour.test.ts`: a test file exports nothing.

/** Opens a paired database with `anime-1` stored WITHOUT a token and two queued rows for it. */
async function openDatabaseWithoutToken(): Promise<SQLiteDatabase> {
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
  for (const createdAt of [1_700_000_000_000, 1_700_000_000_001]) {
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-1', 'update', ?, 'pending', ?)",
      JSON.stringify({ episodesWatched: 5 }),
      createdAt,
    );
  }

  return adapter;
}

/** The bridge's single-anime answer: a `MobileAnime`, with `modified_at` unless it is omitted. */
function animeResponse(modifiedAt?: number) {
  return {
    status: 200,
    body: {
      id: 'anime-1',
      name: 'Test Anime',
      status: 0,
      episodesWatched: 9,
      active: 1,
      firstCycle: 1,
      lastWatchedAt: null,
      premieredAt: null,
      createdAt: null,
      deletedAt: null,
      ...(modifiedAt === undefined ? {} : { modified_at: modifiedAt }),
    },
  };
}

/** A 202 confirming `anime-1` at the given token. */
function confirmedAt(modifiedAt: number) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: [buildAppliedOperation({ anime_id: 'anime-1', operation: 'update', modified_at: modifiedAt })],
      lastChangelogId: 1,
    }),
  };
}

/** A 202 that confirms nothing. */
const EMPTY_RESPONSE = {
  status: 202,
  body: buildReconcileResponseBody({ appliedOperations: [], lastChangelogId: 1 }),
};

/** Reads every outbox row back. */
function readRows(adapter: SQLiteDatabase): Promise<StoredRow[]> {
  return adapter.getAllAsync<StoredRow>(
    'SELECT id, status, claim_owner, claimed_at, unresolved_reason FROM operation_log ORDER BY id',
  );
}

/** Reads `anime-1`'s token and watched count. */
function readAnime(adapter: SQLiteDatabase) {
  return adapter.getFirstAsync<{ bridge_modified_at: number | null; nrocapvisto: number }>(
    "SELECT bridge_modified_at, nrocapvisto FROM animes WHERE _id = 'anime-1'",
  );
}

/** The recorded reconcile requests, in order. */
function reconcileBodies(fakeBridge: FakeBridge): SentReconcileBody[] {
  return fakeBridge.requests
    .filter((request) => request.url.endsWith('/api/sync/reconcile'))
    .map((request) => request.body as SentReconcileBody);
}

/** Every operation any reconcile request carried. */
function allSentOperations(fakeBridge: FakeBridge) {
  return reconcileBodies(fakeBridge).flatMap((body) => body.pending_operations);
}

/** Yields to the event loop until the fake bridge has recorded `count` requests (bounded). */
async function waitForRequests(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('T7 verifier probes (ADR 009 R-3, R-11)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('V1: a token fetched for the old pairing is not stored after an unpair that ran during the fetch', async () => {
    const adapter = await openDatabaseWithoutToken();
    const fetch = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    const cycle = syncPendingOperations(adapter);
    await waitForRequests(fakeBridge, 1);
    await clearBridgeConfig(adapter);
    fetch.release(animeResponse(42));
    await cycle.catch(() => undefined);

    expect((await readAnime(adapter))?.bridge_modified_at).toBeNull();
  });

  it('stores the fetched token while the claim still holds the key, even when the send then fails', async () => {
    const adapter = await openDatabaseWithoutToken();
    fakeBridge.queueResponse(animeResponse(42));
    fakeBridge.queueResponse({ status: 500, body: { error: 'reconcile failed' } });

    await syncPendingOperations(adapter).catch(() => undefined);

    expect(reconcileBodies(fakeBridge)[0].pending_operations).toEqual([
      expect.objectContaining({ anime_id: 'anime-1', base: 42 }),
    ]);
    expect((await readAnime(adapter))?.bridge_modified_at).toBe(42);
  });

  it('V2: rows whose claim was taken over during the fetch are not sent', async () => {
    const adapter = await openDatabaseWithoutToken();
    const fetch = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    const cycle = syncPendingOperations(adapter);
    await waitForRequests(fakeBridge, 1);
    await adapter.runAsync(
      "UPDATE operation_log SET claim_owner = 'native-sync', claimed_at = claimed_at + 61000 WHERE status = 'processing'",
    );
    fetch.release(animeResponse(42));
    await cycle.catch(() => undefined);

    expect(allSentOperations(fakeBridge)).toEqual([]);
  });

  it('V3: a chain fetches once; the successor round rides the confirmed token', async () => {
    const adapter = await openDatabaseWithoutToken();
    fakeBridge.queueResponse(animeResponse(42));
    fakeBridge.queueResponse(confirmedAt(43));
    fakeBridge.queueResponse(confirmedAt(44));

    await syncPendingOperations(adapter);

    expect(fakeBridge.requests.filter((request) => request.method === 'GET')).toHaveLength(1);
    expect(reconcileBodies(fakeBridge).map((body) => body.pending_operations.map((op) => op.base))).toEqual([[42], [43]]);
    expect((await readRows(adapter)).map((row) => row.status)).toEqual(['synced', 'synced']);
  });

  it('V4: a 404 gives up only its own key; another key with a token is still sent', async () => {
    const adapter = await openDatabaseWithoutToken();
    await adapter.runAsync(
      'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'anime-2',
      'Other',
      0,
      1,
      1,
      1,
      70,
    );
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-2', 'update', ?, 'pending', ?)",
      JSON.stringify({ episodesWatched: 2 }),
      1_700_000_000_002,
    );
    fakeBridge.queueResponse({ status: 404, body: { error: 'anime not found' } });
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    await syncPendingOperations(adapter);

    expect(allSentOperations(fakeBridge)).toEqual([expect.objectContaining({ anime_id: 'anime-2', base: 70 })]);
    const rows = await adapter.getAllAsync<{ anime_id: string; status: string; unresolved_reason: string | null }>(
      'SELECT anime_id, status, unresolved_reason FROM operation_log ORDER BY id',
    );
    expect(rows.filter((row) => row.anime_id === 'anime-1').map((row) => row.unresolved_reason)).toEqual([
      'bridge_404',
      'bridge_404',
    ]);
    expect(rows.find((row) => row.anime_id === 'anime-2')?.unresolved_reason).toBeNull();
  });

  it('V5: a 5xx on the fetch keeps the key pending and unclaimed, never unresolved', async () => {
    const adapter = await openDatabaseWithoutToken();
    fakeBridge.queueResponse({ status: 500, body: { error: 'get anime failed' } });
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    await syncPendingOperations(adapter);

    expect(allSentOperations(fakeBridge)).toEqual([]);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner, row.unresolved_reason])).toEqual([
      ['pending', null, null],
      ['pending', null, null],
    ]);
  });

  it('V6: the anime id is URL-encoded in the fetch path', async () => {
    const adapter = await openDatabaseWithoutToken();
    await adapter.runAsync("UPDATE operation_log SET anime_id = 'a b/c'");
    await adapter.runAsync("UPDATE animes SET _id = 'a b/c'");
    fakeBridge.queueResponse({ status: 404, body: { error: 'anime not found' } });
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    await syncPendingOperations(adapter);

    expect(fakeBridge.requests[0].url).toMatch(/\/api\/animes\/a%20b%2Fc$/);
  });
});
