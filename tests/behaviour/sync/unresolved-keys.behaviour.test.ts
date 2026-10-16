import type { SQLiteDatabase } from 'expo-sqlite';
import { listUnresolvedKeys, readUnresolvedKeyCount } from '../../../src/features/sync';
import { resyncFromBridgeSnapshot } from '../../../src/features/sync/full-resync.helpers';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import {
  drainSeasonRatingQueue,
  enqueueSeasonRatingIntent,
} from '../../../src/features/sync/season-rating-queue.helpers';
import { buildUnresolvedSeasonRatingQuery } from '../../../src/features/sync/sync-facade.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { buildReconcileResponseBody } from '../../support/sync-fixtures.helpers';
import {
  animeAnswer,
  openPairedDatabase,
  readAnime,
  readOperationRows,
  readRatingRows,
  reconcileAnswer,
} from './unresolved-fixtures.helpers';

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

/** Queues one season rating of `animeId` and drains it against a bridge answering `status`. */
async function rateAndDrain(adapter: SQLiteDatabase, fakeBridge: FakeBridge, animeId: string, status: number) {
  await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId, nota: 5, ratedAt: 1_700_000_000_000 });
  fakeBridge.queueResponse({ status, body: status === 204 ? null : { error: 'rejected' } });
  await drainSeasonRatingQueue(adapter);
}

/** A reconcile 202 that confirms nothing and carries the PC's rename of `anime-1`. */
function remoteRename(timestamp: number) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: [],
      bridgeChanges: [
        {
          record_id: 'anime-1',
          change_type: 'update',
          changed_fields: ['name'],
          snapshot: { ...animeAnswer({ name: 'Renamed on PC' }).body, modified_at: 0 },
          timestamp,
        },
      ] as never,
      lastChangelogId: 2,
    }),
  };
}

describe('every covered failure becomes a durable, counted unresolved key (ADR 009 R-16b)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
    jest.restoreAllMocks();
  });

  it('counts a dead-lettered key and offers both choices', async () => {
    const adapter = await openPairedDatabase();
    fakeBridge.queueResponse(reconcileAnswer({ applied: false, reason: 'unsupported_operation' }));

    await syncPendingOperations(adapter);

    expect(await listUnresolvedKeys(adapter)).toEqual([
      {
        kind: 'anime',
        animeId: 'anime-1',
        rows: [{ id: 1, status: 'dead_letter', unresolvedReason: null }],
        offeredChoices: ['keep_local', 'keep_bridge'],
      },
    ]);
  });

  it('counts a conflict-exhausted key and offers both choices', async () => {
    const adapter = await openPairedDatabase();
    await adapter.runAsync('UPDATE operation_log SET conflict_attempt_count = 2');
    // The bridge's token did not advance past the sent base (7): the third such conflict.
    fakeBridge.queueResponse(reconcileAnswer({ applied: false, reason: 'conflict', modified_at: 7 }));

    await syncPendingOperations(adapter);

    expect(await listUnresolvedKeys(adapter)).toEqual([
      expect.objectContaining({
        animeId: 'anime-1',
        rows: [{ id: 1, status: 'conflict_exhausted', unresolvedReason: null }],
        offeredChoices: ['keep_local', 'keep_bridge'],
      }),
    ]);
  });

  it.each([
    ['a 404', { status: 404, body: { error: 'anime not found' } }, 'bridge_404'],
    ['an anime with no token', animeAnswer(), 'token_missing'],
  ])('counts the R-3 outcome %s and offers only keep_bridge', async (_label, fetchAnswer, reason) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = await openPairedDatabase({ token: null });
    fakeBridge.queueResponse(fetchAnswer);
    fakeBridge.queueResponse({ status: 202, body: buildReconcileResponseBody({ lastChangelogId: 1 }) });

    await syncPendingOperations(adapter);

    expect(await listUnresolvedKeys(adapter)).toEqual([
      expect.objectContaining({
        animeId: 'anime-1',
        rows: [{ id: 1, status: 'dead_letter', unresolvedReason: reason }],
        offeredChoices: ['keep_bridge'],
      }),
    ]);
  });

  it.each([
    [404, 'not_found', ['keep_bridge']],
    [409, 'conflict', ['keep_local', 'keep_bridge']],
  ])('keeps a rating the bridge answered %i as unresolved and never sends it again', async (status, kind, choices) => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rateAndDrain(adapter, fakeBridge, 'anime-1', status);

    await drainSeasonRatingQueue(adapter);

    expect(fakeBridge.requests).toHaveLength(1);
    expect(await readRatingRows(adapter)).toEqual([
      { id: 1, anime_id: 'anime-1', status: 'failed', last_failure_kind: kind },
    ]);
    expect(await listUnresolvedKeys(adapter)).toEqual([
      { kind: 'season_rating', seasonId: 'season-1', animeId: 'anime-1', rows: [{ id: 1, lastFailureKind: kind }], offeredChoices: choices },
    ]);
  });

  it('counts keys, not rows: two given-up rows of one anime and one rating make two', async () => {
    const adapter = await openPairedDatabase({ episodes: [5, 6] });
    await adapter.runAsync("UPDATE operation_log SET status = 'dead_letter'");
    await rateAndDrain(adapter, fakeBridge, 'anime-2', 404);

    expect(await readUnresolvedKeyCount(adapter)).toBe(2);
  });

  it('counts nothing while nothing is given up', async () => {
    const adapter = await openPairedDatabase();
    await rateAndDrain(adapter, fakeBridge, 'anime-1', 500);

    expect(await readUnresolvedKeyCount(adapter)).toBe(0);
  });
});

describe('an unresolved rating is never counted as pending work (B1)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  // Every 4xx is unresolved since ADR 009 R-5 gave 401 and any other 4xx a terminal fate.
  it.each([404, 409, 401, 422])('drops a rating the bridge answered %i from the pending count', async (status) => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rateAndDrain(adapter, fakeBridge, 'anime-1', status);

    expect(await buildUnresolvedSeasonRatingQuery(adapter)).toHaveLength(0);
  });

  it('still counts a rating the bridge answered 500 (pending, unexpected_response)', async () => {
    const adapter = await openPairedDatabase({ episodes: [] });
    await rateAndDrain(adapter, fakeBridge, 'anime-1', 500);

    expect(await readRatingRows(adapter)).toEqual([
      { id: 1, anime_id: 'anime-1', status: 'pending', last_failure_kind: 'unexpected_response' },
    ]);
    expect(await buildUnresolvedSeasonRatingQuery(adapter)).toEqual([{ id: 1 }]);
  });
});

describe('an unresolved key never blocks the merge or the heal (L18)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('applies an incoming remote change to a conflict-exhausted key', async () => {
    const adapter = await openPairedDatabase();
    await adapter.runAsync("UPDATE operation_log SET status = 'conflict_exhausted'");
    fakeBridge.queueResponse(remoteRename(1_700_000_100_000));

    await syncPendingOperations(adapter);

    expect(await readAnime(adapter)).toEqual(expect.objectContaining({ nombre: 'Renamed on PC' }));
    expect(await readUnresolvedKeyCount(adapter)).toBe(1);
  });

  it('heals a dead-lettered key from the bridge snapshot, token included', async () => {
    const adapter = await openPairedDatabase();
    await adapter.runAsync("UPDATE operation_log SET status = 'dead_letter'");
    fakeBridge.queueResponse({ status: 200, body: [animeAnswer({ name: 'Bridge Name', episodesWatched: 9, token: 30 }).body] });

    const result = await resyncFromBridgeSnapshot(adapter);

    expect(result.healed).toBe(1);
    expect(await readAnime(adapter)).toEqual({ nombre: 'Bridge Name', nrocapvisto: 9, bridge_modified_at: 30 });
    expect((await readOperationRows(adapter)).map((row) => row.status)).toEqual(['dead_letter']);
  });

  it('still skips a key with an unconfirmed edit (existing protection holds)', async () => {
    const adapter = await openPairedDatabase();
    fakeBridge.queueResponse({ status: 200, body: [animeAnswer({ name: 'Bridge Name', token: 30 }).body] });

    const result = await resyncFromBridgeSnapshot(adapter);

    expect(result.healed).toBe(0);
    expect(await readAnime(adapter)).toEqual({ nombre: 'Local Name', nrocapvisto: 4, bridge_modified_at: 7 });
  });
});
