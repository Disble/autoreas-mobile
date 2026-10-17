import type { SQLiteDatabase } from 'expo-sqlite';
import { listUnresolvedKeys } from '../../../src/features/sync';
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

/** One `operation_log` row with its claim columns. */
interface StoredRow {
  id: number;
  anime_id: string;
  status: string;
  claim_owner: string | null;
}

/** The part of a recorded reconcile request body these tests read. */
interface SentReconcileBody {
  last_changelog_id: number;
  client_telemetry?: unknown;
  pending_operations: readonly { anime_id: string }[];
}

/** The `created_at` of the last queued row; each new row lands one millisecond later. */
let nextCreatedAt = 1_700_000_000_000;

/** Opens a paired database with one stored anime (token 7) and one queued row per `animeIds` entry. */
async function openDatabase(animeIds: readonly string[]): Promise<SQLiteDatabase> {
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

  for (const animeId of new Set(animeIds)) {
    await adapter.runAsync(
      'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      animeId,
      'Test Anime',
      0,
      4,
      1,
      1,
      7,
    );
  }

  for (const animeId of animeIds) {
    nextCreatedAt += 1;
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES (?, 'update', ?, 'pending', ?)",
      animeId,
      JSON.stringify({ episodesWatched: 5 }),
      nextCreatedAt,
    );
  }

  return adapter;
}

/** A 202 confirming one row of each of `animeIds`. */
function confirming(...animeIds: string[]) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: animeIds.map((animeId) =>
        buildAppliedOperation({ anime_id: animeId, operation: 'update', applied: true, modified_at: 14 })),
      lastChangelogId: 1,
    }),
  };
}

/** A 202 confirming one row of `animeId` and reaching changelog `lastChangelogId`. */
function confirmingAt(animeId: string, lastChangelogId: number) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: [
        buildAppliedOperation({ anime_id: animeId, operation: 'update', applied: true, modified_at: 14 }),
      ],
      lastChangelogId,
    }),
  };
}

/** Lets the cycle reach its pending request before the test acts on the database. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** A whole-request rejection with `status`. */
function rejecting(status: number) {
  return { status, body: { error: 'rejected' } };
}

/** Reads every outbox row back with its claim owner. */
function readRows(adapter: SQLiteDatabase): Promise<StoredRow[]> {
  return adapter.getAllAsync<StoredRow>(
    'SELECT id, anime_id, status, claim_owner FROM operation_log ORDER BY id',
  );
}

/** The anime ids each recorded reconcile request carried, in send order. */
function sentAnimeIds(fakeBridge: FakeBridge): string[][] {
  return fakeBridge.requests.map((request) =>
    (request.body as SentReconcileBody).pending_operations.map((operation) => operation.anime_id));
}

/** Every recorded reconcile request body, in send order. */
function sentBodies(fakeBridge: FakeBridge): SentReconcileBody[] {
  return fakeBridge.requests.map((request) => request.body as SentReconcileBody);
}

describe('per-message failure in the anime outbox (ADR 009 R-5)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('isolates a 4xx to the one message that caused it: the other key is confirmed and chained in the same cycle', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b', 'anime-b']);
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse(confirming('anime-b'));
    fakeBridge.queueResponse(confirming('anime-b'));

    const result = await syncPendingOperations(adapter);

    expect(sentAnimeIds(fakeBridge)).toEqual([['anime-a', 'anime-b'], ['anime-a'], ['anime-b'], ['anime-b']]);
    expect(await readRows(adapter)).toEqual([
      { id: 1, anime_id: 'anime-a', status: 'dead_letter', claim_owner: null },
      { id: 2, anime_id: 'anime-b', status: 'synced', claim_owner: null },
      { id: 3, anime_id: 'anime-b', status: 'synced', claim_owner: null },
    ]);
    expect(result.syncedCount).toBe(2);
  });

  it('dead-letters every held row of the round on a 401, sends no message alone, and fails the cycle', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b']);
    fakeBridge.queueResponse(rejecting(401));

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect(fakeBridge.requests).toHaveLength(1);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['dead_letter', null],
      ['dead_letter', null],
    ]);
    expect((await listUnresolvedKeys(adapter)).map((key) => key.animeId)).toEqual(['anime-a', 'anime-b']);
  });

  it('releases every unsent message, unclaimed, when an isolated send fails on the network', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b', 'anime-c']);
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse({ status: 503, body: { error: 'down' } });

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect(sentAnimeIds(fakeBridge)).toEqual([['anime-a', 'anime-b', 'anime-c'], ['anime-a']]);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['pending', null],
      ['pending', null],
      ['pending', null],
    ]);
  });

  it('releases the successor an isolated message already chained when a later isolated send fails', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b', 'anime-a']);
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse(confirming('anime-a'));
    fakeBridge.queueResponse({ status: 503, body: { error: 'down' } });

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect((await readRows(adapter)).map((row) => [row.anime_id, row.status, row.claim_owner])).toEqual([
      ['anime-a', 'synced', null],
      ['anime-b', 'pending', null],
      ['anime-a', 'pending', null],
    ]);
  });

  it('sends each isolated message on the cursor the previous one reached, and stores the last', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b', 'anime-c']);
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse(confirmingAt('anime-a', 5));
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse(confirmingAt('anime-c', 9));

    await syncPendingOperations(adapter);

    expect(sentBodies(fakeBridge).map((body) => body.last_changelog_id)).toEqual([0, 0, 5, 5]);
    expect(sentAnimeIds(fakeBridge)).toEqual([['anime-a', 'anime-b', 'anime-c'], ['anime-a'], ['anime-b'], ['anime-c']]);
    const config = await adapter.getFirstAsync<{ last_changelog_id: number }>(
      'SELECT last_changelog_id FROM bridge_config WHERE id = 1',
    );
    expect(config?.last_changelog_id).toBe(9);
    expect((await readRows(adapter)).map((row) => row.status)).toEqual(['synced', 'dead_letter', 'synced']);
  });

  it('never re-sends a row the other runtime took over between the rejection and its isolated send', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b']);
    const firstRound = fakeBridge.queueDeferredResponse();
    fakeBridge.queueResponse(confirmingAt('anime-a', 3));

    const cycle = syncPendingOperations(adapter);
    await settle();
    await adapter.runAsync(
      "UPDATE operation_log SET claim_owner = 'native', claimed_at = 999 WHERE anime_id = 'anime-b'",
    );
    firstRound.release(rejecting(422));
    await cycle;

    expect(sentAnimeIds(fakeBridge)).toEqual([['anime-a', 'anime-b'], ['anime-a']]);
    expect(await readRows(adapter)).toEqual([
      { id: 1, anime_id: 'anime-a', status: 'synced', claim_owner: null },
      { id: 2, anime_id: 'anime-b', status: 'processing', claim_owner: 'native' },
    ]);
  });

  it('leaves no row processing and no successor claimed when an isolated send fails in transport', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b', 'anime-a', 'anime-c']);
    fakeBridge.queueResponse(rejecting(400));
    fakeBridge.queueResponse(confirmingAt('anime-a', 2));
    const transport = fakeBridge.queueDeferredResponse();

    const cycle = syncPendingOperations(adapter);
    await settle();
    transport.reject(new TypeError('Network request failed'));
    await expect(cycle).rejects.toThrow();

    expect((await readRows(adapter)).map((row) => [row.anime_id, row.status, row.claim_owner])).toEqual([
      ['anime-a', 'synced', null],
      ['anime-b', 'pending', null],
      ['anime-a', 'pending', null],
      ['anime-c', 'pending', null],
    ]);
  });

  it('sends the isolated messages without the telemetry piggyback', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b']);
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse(confirmingAt('anime-a', 1));
    fakeBridge.queueResponse(confirmingAt('anime-b', 2));

    await syncPendingOperations(adapter);

    expect(sentBodies(fakeBridge).slice(1).map((body) => body.client_telemetry)).toEqual([undefined, undefined]);
  });

  it('dead-letters the message a 401 lands on during isolation and releases the rest', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b']);
    fakeBridge.queueResponse(rejecting(422));
    fakeBridge.queueResponse(rejecting(401));

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['dead_letter', null],
      ['pending', null],
    ]);
  });

  it('releases the in-flight message and every unsent one when a local write fails during an isolated send', async () => {
    const adapter = await openDatabase(['anime-a', 'anime-b']);
    fakeBridge.queueResponse(rejecting(422));
    const isolatedSend = fakeBridge.queueDeferredResponse();

    const cycle = syncPendingOperations(adapter);
    await settle();
    await adapter.runAsync('ALTER TABLE animes RENAME TO animes_gone');
    isolatedSend.release(confirmingAt('anime-a', 3));
    await expect(cycle).rejects.toThrow();

    expect((await readRows(adapter)).map((row) => [row.anime_id, row.status, row.claim_owner])).toEqual([
      ['anime-a', 'pending', null],
      ['anime-b', 'pending', null],
    ]);
  });
});
