import { syncPendingOperations } from '../../../src/features/sync/reconcile.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { confirmed, openDatabase, paths, pullOnly, readRows, seed } from './season-rating-fixtures.helpers';

// Same seam as `season-rating-outbox.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** The bridge's answer to a recorded rating. */
const DELIVERED = { status: 204, body: null };

/** Makes every status write matching `condition` fail, like a local write error. */
function failStatusWrite(adapter: Awaited<ReturnType<typeof openDatabase>>, condition: string): Promise<void> {
  return adapter.execAsync(
    `CREATE TRIGGER fail_status_write BEFORE UPDATE OF status ON operation_log WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END`,
  );
}

/** Hands row `id` to the native runtime, as its pass would take over a row whose claim it found free. */
function claimForNative(adapter: Awaited<ReturnType<typeof openDatabase>>, id: number): void {
  adapter.runSync("UPDATE operation_log SET claim_owner = 'native', claimed_at = ? WHERE id = ?", Date.now(), id);
}

/** Resolves once the fake bridge has received `count` requests. */
async function waitForRequests(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// T17 B1/B2 (ADR 009 R-5 I4, R-13, S8): mirrors `SyncEngineSeasonRatingWriteFailureTest.kt`.
describe('a local write failure around a season rating never strands a claimed row', () => {
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

  it('releases a rating whose delivery could not be written, and still sends the next rating', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    await failStatusWrite(adapter, "OLD.id = 1 AND NEW.status = 'synced'");
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse(DELIVERED);
    fakeBridge.queueResponse(DELIVERED);

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile', '/api/seasons/active/ratings', '/api/seasons/active/ratings']);
    expect(result).toMatchObject({ syncedCount: 1, hasMorePending: true });
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['pending', null],
      ['synced', null],
    ]);
  });

  it('leaves a rating to its claim expiry when its release cannot be written either, and goes on', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    // Once row 1 is claimed every status write of it fails: the settle and the separate release.
    await failStatusWrite(adapter, "OLD.id = 1 AND OLD.status = 'processing'");
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse(DELIVERED);
    fakeBridge.queueResponse(DELIVERED);

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile', '/api/seasons/active/ratings', '/api/seasons/active/ratings']);
    expect(result).toMatchObject({ syncedCount: 1, hasMorePending: true });
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['processing', 'js'],
      ['synced', null],
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      '[releaseHeldRows] Could not release claimed rows; their claim expiry releases them',
      expect.objectContaining({ ids: [1] }),
    );
  });

  it('releases the round ratings unsent when the reconcile fails locally', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    await failStatusWrite(adapter, "OLD.operation = 'update' AND NEW.status = 'synced'");
    fakeBridge.queueResponse(confirmed(14));

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile']);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['pending', null],
      ['pending', null],
    ]);
  });

  it('never strands the successor an earlier delivery claimed when a later rating fails to write', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'update' });
    await seed(adapter, { id: 3, operation: 'season_rating', animeId: 'anime-2' });
    await failStatusWrite(adapter, "OLD.id = 3 AND NEW.status = 'synced'");
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse(DELIVERED);
    fakeBridge.queueResponse(DELIVERED);
    fakeBridge.queueResponse(confirmed(14));

    await syncPendingOperations(adapter);

    const rows = await readRows(adapter);
    expect(rows.filter((row) => row.status === 'processing')).toEqual([]);
    expect(rows[0]).toMatchObject({ status: 'synced', claim_owner: null });
  });

  it('leaves a rating to the runtime that took it over between its failed settle and its release, and still sends the other', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    await failStatusWrite(adapter, "OLD.id = 1 AND NEW.status = 'synced'");
    (console.warn as jest.Mock).mockImplementation((message: unknown) => {
      if (String(message).includes('Could not record a rating answer')) {
        claimForNative(adapter, 1);
      }
    });
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse(DELIVERED);
    fakeBridge.queueResponse(DELIVERED);

    const result = await syncPendingOperations(adapter);

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile', '/api/seasons/active/ratings', '/api/seasons/active/ratings']);
    expect(result).toMatchObject({ syncedCount: 1, hasMorePending: true });
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['processing', 'native'],
      ['synced', null],
    ]);
  });

  it('leaves the round rating to the runtime that took it over while the reconcile was out, when the reconcile then fails locally', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    await failStatusWrite(adapter, "OLD.operation = 'update' AND NEW.status = 'synced'");
    const reconcile = fakeBridge.queueDeferredResponse();

    const cycle = syncPendingOperations(adapter);
    await waitForRequests(fakeBridge, 1);
    claimForNative(adapter, 2);
    reconcile.release(confirmed(14));

    await expect(cycle).rejects.toThrow();
    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile']);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['pending', null],
      ['processing', 'native'],
    ]);
  });

  it('keeps the rows settled earlier in the pass synced when a later reconcile fails locally', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'season_rating' });
    await seed(adapter, { id: 2, operation: 'update' });
    await seed(adapter, { id: 3, operation: 'season_rating', animeId: 'anime-2' });
    await failStatusWrite(adapter, "OLD.id = 2 AND NEW.status = 'synced'");
    fakeBridge.queueResponse(pullOnly());
    fakeBridge.queueResponse(DELIVERED);
    fakeBridge.queueResponse(DELIVERED);
    fakeBridge.queueResponse(confirmed(14));

    await expect(syncPendingOperations(adapter)).rejects.toThrow();

    expect(paths(fakeBridge)).toEqual([
      '/api/sync/reconcile',
      '/api/seasons/active/ratings',
      '/api/seasons/active/ratings',
      '/api/sync/reconcile',
    ]);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['synced', null],
      ['pending', null],
      ['synced', null],
    ]);
  });

  it('keeps an update the bridge rejected with a 400 dead-lettered, and releases the round rating unsent', async () => {
    const adapter = await openDatabase();
    await seed(adapter, { id: 1, operation: 'update' });
    await seed(adapter, { id: 2, operation: 'season_rating', animeId: 'anime-2' });
    fakeBridge.queueResponse({ status: 400, body: { error: 'bad' } });

    await expect(syncPendingOperations(adapter)).rejects.toThrow('Reconcile failed: 400');

    expect(paths(fakeBridge)).toEqual(['/api/sync/reconcile']);
    expect((await readRows(adapter)).map((row) => [row.status, row.claim_owner])).toEqual([
      ['dead_letter', null],
      ['pending', null],
    ]);
  });
});
