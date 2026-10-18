import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { createRequestIdSequence } from '../../../src/features/sync/request-id.helpers';
import { bridgeClient } from '../../../src/infrastructure/api';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { buildAppliedOperation, buildReconcileResponseBody } from '../../support/sync-fixtures.helpers';
import { confirmed, openDatabase, paths, seed } from './season-rating-fixtures.helpers';

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

/** The header every request of one sync cycle carries (S1). */
const REQUEST_ID_HEADER = 'X-Autoreas-Request-Id';

/** The request id each recorded request carried, or `undefined` when it carried none. */
function sentRequestIds(fakeBridge: FakeBridge): (string | undefined)[] {
  return fakeBridge.requests.map((request) => request.headers[REQUEST_ID_HEADER]);
}

/** Asserts every request carries `<one cycle id>:<n>` with n counting 1, 2, 3... in send order. */
function expectOneNumberedCycle(fakeBridge: FakeBridge): string {
  const ids = sentRequestIds(fakeBridge);
  const cycleId = ids[0]?.split(':')[0] ?? '';

  expect(cycleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(ids).toEqual(ids.map((_id, index) => `${cycleId}:${index + 1}`));

  return cycleId;
}

/** A reconcile answer confirming one `update` of each of `animeIds`. */
function confirming(...animeIds: string[]) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: animeIds.map((animeId) =>
        buildAppliedOperation({ anime_id: animeId, applied: true, modified_at: 14 })),
      lastChangelogId: 1,
    }),
  };
}

describe('request correlation ids on the JS sync cycle (S1, S2, S4)', () => {
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

  it('numbers the reconciles, the rating and the pull after it of one cycle under one id', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating' });
    await seed(adapter, { id: 3, operation: 'update' });
    fakeBridge.queueResponse(confirmed(14));
    fakeBridge.queueResponse({ status: 204, body: null });
    fakeBridge.queueResponse(confirmed(15));
    fakeBridge.queueResponse(confirming());
    const requestIds = createRequestIdSequence();

    await syncPendingOperations(adapter, requestIds);
    // The facade's pull after a delivered rating shares the cycle's sequence.
    await syncPendingOperations(adapter, requestIds);

    expect(paths(fakeBridge)).toEqual([
      '/api/sync/reconcile',
      '/api/seasons/active/ratings',
      '/api/sync/reconcile',
      '/api/sync/reconcile',
    ]);
    expect(expectOneNumberedCycle(fakeBridge)).toBe(requestIds.cycleId);
  });

  it('numbers the fetch-first GETs and every isolation re-send of one cycle', async () => {
    const adapter = await openDatabase(null);
    await seed(adapter, { id: 1, operation: 'update', animeId: 'anime-1' });
    await seed(adapter, { id: 2, operation: 'update', animeId: 'anime-2' });
    fakeBridge.queueResponse({ status: 200, body: { _id: 'anime-1', modified_at: 7 } });
    fakeBridge.queueResponse({ status: 200, body: { _id: 'anime-2', modified_at: 7 } });
    fakeBridge.queueResponse({ status: 422, body: { error: 'rejected' } });
    fakeBridge.queueResponse(confirming('anime-1'));
    fakeBridge.queueResponse(confirming('anime-2'));

    await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual([
      '/api/animes/anime-1',
      '/api/animes/anime-2',
      '/api/sync/reconcile',
      '/api/sync/reconcile',
      '/api/sync/reconcile',
    ]);
    expectOneNumberedCycle(fakeBridge);
  });

  it('starts a new id and a new count for the next cycle', async () => {
    const adapter = await openDatabase();
    fakeBridge.queueResponse(confirming());
    fakeBridge.queueResponse(confirming());

    await syncPendingOperations(adapter);
    await syncPendingOperations(adapter);

    const [first, second] = sentRequestIds(fakeBridge);
    expect(first?.endsWith(':1')).toBe(true);
    expect(second?.endsWith(':1')).toBe(true);
    expect(second?.split(':')[0]).not.toBe(first?.split(':')[0]);
  });

  it('sends no request id on a call made outside a sync cycle', async () => {
    fakeBridge.queueResponse({ status: 200, body: [] });

    await bridgeClient.listAnimes({ ip: '192.168.0.10', port: 8080, token: 'token-1' });

    expect(fakeBridge.requests[0].headers).toEqual({ Authorization: 'Bearer token-1' });
  });
});
