import type { SQLiteDatabase } from 'expo-sqlite';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
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

describe('fetch-first when a token is missing (ADR 009 R-3)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('fetches the anime first, stores only its token and sends with that base', async () => {
    const adapter = await openDatabaseWithoutToken();
    fakeBridge.queueResponse(animeResponse(42));
    fakeBridge.queueResponse(confirmedAt(43));
    fakeBridge.queueResponse(confirmedAt(44));

    await syncPendingOperations(adapter);

    expect(fakeBridge.requests[0].method).toBe('GET');
    expect(fakeBridge.requests[0].url).toMatch(/\/api\/animes\/anime-1$/);
    expect(reconcileBodies(fakeBridge)[0].pending_operations).toEqual([
      expect.objectContaining({ anime_id: 'anime-1', base: 42 }),
    ]);
    // Only the token: the fetched episodesWatched (9) never reaches the local row.
    expect(await readAnime(adapter)).toEqual({ bridge_modified_at: 44, nrocapvisto: 4 });
  });

  it('makes the key unresolved on a 404 and sends none of its rows', async () => {
    const adapter = await openDatabaseWithoutToken();
    fakeBridge.queueResponse({ status: 404, body: { error: 'anime not found' } });
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    await syncPendingOperations(adapter);

    expect(allSentOperations(fakeBridge)).toEqual([]);
    const unresolved = { status: 'dead_letter', claim_owner: null, claimed_at: null, unresolved_reason: 'bridge_404' };
    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, ...unresolved }),
      expect.objectContaining({ id: 2, ...unresolved }),
    ]);
    expect((await readAnime(adapter))?.bridge_modified_at).toBeNull();
  });

  it('makes the key unresolved and logs it when the anime comes back with no token', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = await openDatabaseWithoutToken();
    fakeBridge.queueResponse(animeResponse());
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    await syncPendingOperations(adapter);

    expect(allSentOperations(fakeBridge)).toEqual([]);
    expect((await readRows(adapter)).map((row) => row.unresolved_reason)).toEqual(['token_missing', 'token_missing']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('token_missing'), expect.anything());
    warn.mockRestore();
  });

  it('leaves the rows pending and unclaimed when the bridge cannot be reached', async () => {
    const adapter = await openDatabaseWithoutToken();
    const fetch = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(EMPTY_RESPONSE);

    const cycle = syncPendingOperations(adapter);
    for (let attempt = 0; attempt < 200 && fakeBridge.requests.length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    fetch.reject(new TypeError('Network request failed'));
    await cycle;

    expect(allSentOperations(fakeBridge)).toEqual([]);
    const untouched = { status: 'pending', claim_owner: null, claimed_at: null, unresolved_reason: null };
    expect(await readRows(adapter)).toEqual([
      expect.objectContaining({ id: 1, ...untouched }),
      expect.objectContaining({ id: 2, ...untouched }),
    ]);
  });

});
