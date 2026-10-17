import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { confirmed, openDatabase, paths, pullOnly, readRows, seed, waitForRequests } from './season-rating-fixtures.helpers';

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

/** The claim the other runtime writes when it takes a key over. */
const NATIVE_CLAIM_SQL = "UPDATE operation_log SET status = 'processing', claim_owner = 'native', claimed_at = ? WHERE id = ?";

describe('a rating shares its anime key claim (ADR 009 R-13; L28)', () => {
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

  it('skips a rating whose anime the other runtime holds with a live claim', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await adapter.runAsync(NATIVE_CLAIM_SQL, Date.now(), 1);
    fakeBridge.queueResponse(pullOnly());

    await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile']);
    expect(await readRows(adapter)).toEqual([
      { id: 1, operation: 'season_rating', status: 'processing', unresolved_reason: null, claim_owner: 'native' },
    ]);
  });

  it('never posts a rating the other runtime took over while the round reconciled', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    const held = fakeBridge.queueDeferredResponse();

    const cycle = syncPendingOperations(adapter);
    await waitForRequests(fakeBridge, 1);
    await adapter.runAsync(NATIVE_CLAIM_SQL, Date.now() + 1, 2);
    held.release(confirmed(14));
    await cycle;

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile']);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['synced', null],
      ['processing', 'native'],
    ]);
  });

  it('never overwrites a rating the other runtime took over while it was in flight', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    fakeBridge.queueResponse(pullOnly());
    const held = fakeBridge.queueDeferredResponse();

    const cycle = syncPendingOperations(adapter);
    await waitForRequests(fakeBridge, 2);
    await adapter.runAsync(NATIVE_CLAIM_SQL, Date.now() + 1, 1);
    held.release({ status: 204, body: null });
    const result = await cycle;

    expect(result.syncedCount).toBe(0);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([['processing', 'native']]);
  });

  it('holds its own claim while the rating is in flight and releases it on a retryable answer', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    fakeBridge.queueResponse(pullOnly());
    const held = fakeBridge.queueDeferredResponse();

    const cycle = syncPendingOperations(adapter);
    await waitForRequests(fakeBridge, 2);
    const inFlight = await readRows(adapter);
    held.release({ status: 503, body: { error: 'down' } });
    await cycle;

    expect(inFlight.map((row) => [row.status, row.claim_owner])).toEqual([['processing', 'js']]);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([['pending', null]]);
  });
});
