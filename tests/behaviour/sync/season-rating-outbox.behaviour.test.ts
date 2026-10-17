import { listUnresolvedKeys, readUnresolvedKeyCount, resolveUnresolvedKey } from '../../../src/features/sync';
import { loadPendingOutboxRecordIds } from '../../../src/features/sync/merge/merge-context.helpers';
import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { buildPendingOperationsQuery } from '../../../src/features/sync/sync-facade.helpers';
import { createDrizzleDb } from '../../../src/infrastructure/db/client/client.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { RATING, RATING_BODY } from './season-rating-fixtures.constants';
import { confirmed, openDatabase, paths, pullOnly, readRows, seed } from './season-rating-fixtures.helpers';

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

describe('season ratings travel in the anime outbox (ADR 009 R-2 I1, R-5, R-14; L20, L28)', () => {
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

  it('sends the rows of one anime in order across both endpoints', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating' });
    await seed(adapter, { id: 3, operation: 'update' });
    fakeBridge.queueResponse(confirmed(14));
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse(confirmed(15));

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile', '/api/seasons/active/ratings', '/api/sync/reconcile']);
    expect(fakeBridge.requests[1].body).toEqual(RATING_BODY);
    // Each reconcile carries only the anime's `update` row, on the token the previous one returned.
    expect(fakeBridge.requests.filter((_r, index) => index !== 1).map((request) =>
      (request.body as { pending_operations: { operation: string; base: number }[] }).pending_operations.map((op) => [op.operation, op.base]),
    )).toEqual([[['update', 7]], [['update', 14]]]);
    expect(result).toMatchObject({ syncedCount: 3, hasMorePending: false, shouldRefreshActiveSeason: true });
    expect((await readRows(adapter)).map((row) => row.status)).toEqual(['synced', 'synced', 'synced']);
  });

  it('stops the key at a rejected rating, so the next edit waits for the next cycle', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating' });
    await seed(adapter, { id: 3, operation: 'update' });
    fakeBridge.queueResponse(confirmed(14));
    fakeBridge.queueResponse({ status: 409, body: { grade: 3, source: 'manual' } });

    await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile', '/api/seasons/active/ratings']);
    expect((await readRows(adapter)).map((row) => [row.status, row.unresolved_reason, row.claim_owner])).toEqual([
      ['synced', null, null],
      ['dead_letter', 'conflict', null],
      ['pending', null, null],
    ]);

    fakeBridge.queueResponse(confirmed(15));
    await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toHaveLength(3);
    expect((await readRows(adapter))[2].status).toBe('synced');
  });

  it('stops chaining after a delivered rating once the 20 s chain budget is spent', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'update' });
    const startedAt = Date.now();
    // The clock jumps past the budget while the rating is in flight.
    jest.spyOn(Date, 'now').mockImplementation(() => (fakeBridge.requests.length >= 2 ? startedAt + 21_000 : startedAt));
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse({ status: 204, body: null });

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile', '/api/seasons/active/ratings']);
    expect(result).toMatchObject({ syncedCount: 1, hasMorePending: true });
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['synced', null],
      ['pending', null],
    ]);
  });

  it('releases the round ratings unsent when the reconcile fails', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    fakeBridge.queueResponse({ status: 500, body: { error: 'boom' } });

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile']);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['pending', null],
      ['pending', null],
    ]);
  });

  it.each([
    [204, 'synced', null, true, false],
    [401, 'dead_letter', 'auth_repair', false, false],
    [403, 'dead_letter', 'rejected', false, false],
    [404, 'dead_letter', 'not_found', true, false],
    [409, 'dead_letter', 'conflict', true, false],
    [422, 'dead_letter', 'rejected', false, false],
    [503, 'pending', null, false, true],
  ] as const)('a rating answered %i ends %s (%s) and never fails the attempt', async (code, status, reason, refresh, more) => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse({ status: code, body: code === 204 ? null : { error: 'no' } });

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile', '/api/seasons/active/ratings']);
    expect(result).toMatchObject({ hasMorePending: more, shouldRefreshActiveSeason: refresh });
    expect(await readRows(adapter)).toEqual([
      { id: 1, operation: 'season_rating', status, unresolved_reason: reason, claim_owner: null },
    ]);
  });

  it('keeps a rating whose own request failed on the wire pending, and still sends the next one', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueTransportFailure();
    fakeBridge.queueResponse({ status: 204, body: null });

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toHaveLength(3);
    expect(result.hasMorePending).toBe(true);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['pending', null],
      ['synced', null],
    ]);
  });

  it('never fails the attempt over a rating whose answer could not be written, and still sends the next', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    const getAllAsync = adapter.getAllAsync.bind(adapter);
    let reads = 0;
    // The held-row re-read inside the settling write door of the first rating fails.
    jest.spyOn(adapter, 'getAllAsync').mockImplementation(((sql: string, ...params: unknown[]) => {
      if (sql.includes('claim_owner') && params.includes(1) && fakeBridge.requests.length === 2 && (reads += 1) === 1) {
        return Promise.reject(new Error('disk I/O error'));
      }
      return (getAllAsync as (...args: unknown[]) => unknown)(sql, ...params);
    }) as typeof adapter.getAllAsync);
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse({ status: 204, body: null });

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toHaveLength(3);
    expect(result).toMatchObject({ syncedCount: 1, hasMorePending: true });
    // The row whose answer could not be written is released to pending in a separate write.
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['pending', null],
      ['synced', null],
    ]);
  });

  it('never lets a pending rating defer the bridge changes or the heal of its anime', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });

    expect(await loadPendingOutboxRecordIds(createDrizzleDb(adapter))).toEqual(new Set());

    await seed(adapter, { id: 2, operation: 'update', animeId: 'anime-2' });
    expect(await loadPendingOutboxRecordIds(createDrizzleDb(adapter))).toEqual(new Set(['anime-2']));
  });

  it('never gives a pending rating up when fetch-first gives its anime up', async () => {
    const adapter = await openDatabase(null);
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating' });
    fakeBridge.queueResponse({ status: 404, body: { error: 'not found' } });
    fakeBridge.queueResponse(pullOnly());

    await syncPendingOperations(adapter);

    expect((await readRows(adapter)).map((row) => [row.status, row.unresolved_reason])).toEqual([
      ['dead_letter', 'bridge_404'],
      ['pending', null],
    ]);
  });

  it('counts a queued rating as pending work', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2', status: 'dead_letter', reason: 'conflict' });

    expect(await buildPendingOperationsQuery(adapter)).toEqual([{ id: 1 }]);
  });
});

describe('unresolved ratings are their own key inside the anime outbox (ADR 009 R-16b; L28)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists a given-up rating as a season_rating key and a given-up edit as an anime key', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update', status: 'dead_letter' });
    await seed(adapter, { id: 2, operation: 'season_rating', status: 'dead_letter', reason: 'conflict' });
    await seed(adapter, { id: 3, operation: 'season_rating', animeId: 'anime-2', status: 'dead_letter', reason: 'not_found' });
    await seed(adapter, { id: 4, operation: 'season_rating', status: 'pending' });

    expect(await listUnresolvedKeys(adapter)).toEqual([
      {
        kind: 'anime',
        animeId: 'anime-1',
        rows: [{ id: 1, status: 'dead_letter', unresolvedReason: null }],
        offeredChoices: ['keep_local', 'keep_bridge'],
      },
      {
        kind: 'season_rating',
        seasonId: 'season-1',
        animeId: 'anime-1',
        rows: [{ id: 2, unresolvedReason: 'conflict' }],
        offeredChoices: ['keep_local', 'keep_bridge'],
      },
      {
        kind: 'season_rating',
        seasonId: 'season-1',
        animeId: 'anime-2',
        rows: [{ id: 3, unresolvedReason: 'not_found' }],
        offeredChoices: ['keep_bridge'],
      },
    ]);
    expect(await readUnresolvedKeyCount(adapter)).toBe(3);
  });

  it('keep_local sends a rating again; it leaves the anime token alone', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating', status: 'dead_letter', reason: 'conflict' });

    await resolveUnresolvedKey(adapter, { kind: 'season_rating', seasonId: 'season-1', animeId: 'anime-1' }, 'keep_local');

    expect((await readRows(adapter)).map((row) => [row.status, row.unresolved_reason])).toEqual([['pending', null]]);
    expect(await adapter.getFirstAsync("SELECT bridge_modified_at FROM animes WHERE _id = 'anime-1'")).toEqual({ bridge_modified_at: 7 });
  });

  it('keep_bridge drops the rating key rows of that season only', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating', status: 'dead_letter', reason: 'not_found' });
    await seed(adapter, { id: 2, operation: 'season_rating', payload: { ...RATING, seasonId: 'season-0' } });
    await seed(adapter, { id: 3, operation: 'season_rating' });
    await seed(adapter, { id: 4, operation: 'update' });

    await resolveUnresolvedKey(adapter, { kind: 'season_rating', seasonId: 'season-1', animeId: 'anime-1' }, 'keep_bridge');

    expect((await readRows(adapter)).map((row) => row.id)).toEqual([2, 4]);
  });

  it('keep_bridge for an anime key leaves its queued ratings alone', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update', status: 'dead_letter', reason: 'bridge_404' });
    await seed(adapter, { id: 2, operation: 'season_rating' });
    const fakeBridge = installFakeBridge();
    fakeBridge.queueResponse({ status: 404, body: { error: 'not found' } });

    try {
      await resolveUnresolvedKey(adapter, { kind: 'anime', animeId: 'anime-1' }, 'keep_bridge');
    } finally {
      fakeBridge.restore();
    }

    expect((await readRows(adapter)).map((row) => [row.id, row.operation])).toEqual([[2, 'season_rating']]);
  });

  it('resolves automatically only within its kind and season', async () => {
    const adapter = await openDatabase();
    const fakeBridge = installFakeBridge();
    await seed(adapter, { id: 1, operation: 'season_rating', status: 'dead_letter', reason: 'conflict' });
    await seed(adapter, { id: 2, operation: 'season_rating', payload: { ...RATING, seasonId: 'season-0' }, status: 'dead_letter', reason: 'rejected' });
    await seed(adapter, { id: 3, operation: 'update', status: 'dead_letter' });
    await seed(adapter, { id: 4, operation: 'update' });
    fakeBridge.queueResponse(confirmed(14));
    fakeBridge.queueResponse({ status: 204, body: null });
    await seed(adapter, { id: 5, operation: 'season_rating' });

    try {
      await syncPendingOperations(adapter);
    } finally {
      fakeBridge.restore();
    }

    // The confirmed edit (4) resolves only the given-up edit (3); the delivered rating (5) only
    // the given-up rating of its own season (1).
    expect((await readRows(adapter)).map((row) => [row.id, row.status])).toEqual([
      [2, 'dead_letter'],
      [4, 'synced'],
      [5, 'synced'],
    ]);
  });
});
