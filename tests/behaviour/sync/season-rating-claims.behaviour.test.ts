import type { SQLiteDatabase } from 'expo-sqlite';
import {
  drainSeasonRatingQueue,
  enqueueSeasonRatingIntent,
} from '../../../src/features/sync/season-rating-queue.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// Same seam as `season-rating.behaviour.test.ts`: only the drizzle factory is swapped.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** One `season_rating_queue` row with its claim columns. */
interface StoredClaimRow {
  status: string;
  claim_owner: string | null;
  claimed_at: number | null;
}

/** Yields to the event loop until the fake bridge has received `count` requests. */
async function waitForRequestCount(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Opens a migrated, paired database with one queued rating for `season-1`. */
async function openDatabaseWithRating(): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id) VALUES (1, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
  );
  await enqueueSeasonRatingIntent(adapter, {
    seasonId: 'season-1',
    animeId: 'anime-1',
    nota: 8,
    ratedAt: 1_700_000_000_000,
  });

  return adapter;
}

/** Puts every queued row of the database into the given claim state. */
async function setClaim(adapter: SQLiteDatabase, claim: StoredClaimRow): Promise<void> {
  await adapter.runAsync(
    'UPDATE season_rating_queue SET status = ?, claim_owner = ?, claimed_at = ?',
    claim.status,
    claim.claim_owner,
    claim.claimed_at,
  );
}

/** Reads the queue back with its claim columns, oldest first. */
function readQueue(adapter: SQLiteDatabase): Promise<StoredClaimRow[]> {
  return adapter.getAllAsync<StoredClaimRow>(
    'SELECT status, claim_owner, claimed_at FROM season_rating_queue ORDER BY id ASC',
  );
}

describe('per-season claims on the rating queue (ADR 009 R-13)', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('skips a season the other runtime holds with a live claim, without touching the row', async () => {
    const adapter = await openDatabaseWithRating();
    const liveNativeClaim = { status: 'syncing', claim_owner: 'native', claimed_at: Date.now() - 10_000 };
    await setClaim(adapter, liveNativeClaim);

    await drainSeasonRatingQueue(adapter);

    expect(fakeBridge.requests).toHaveLength(0);
    await expect(readQueue(adapter)).resolves.toEqual([liveNativeClaim]);
  });

  it('skips every row of a season while another row of that season is claimed', async () => {
    const adapter = await openDatabaseWithRating();
    await adapter.runAsync(
      "UPDATE season_rating_queue SET status = 'syncing', claim_owner = 'native', claimed_at = ?",
      Date.now() - 10_000,
    );
    await enqueueSeasonRatingIntent(adapter, {
      seasonId: 'season-1',
      animeId: 'anime-2',
      nota: 6,
      ratedAt: 1_700_000_000_001,
    });

    await drainSeasonRatingQueue(adapter);

    expect(fakeBridge.requests).toHaveLength(0);
  });

  it('takes a season whose claim expired after 60 s', async () => {
    const adapter = await openDatabaseWithRating();
    await setClaim(adapter, { status: 'syncing', claim_owner: 'native', claimed_at: Date.now() - 61_000 });
    fakeBridge.queueResponse({ status: 204, body: null });

    const result = await drainSeasonRatingQueue(adapter);

    expect(result.deliveredCount).toBe(1);
    await expect(readQueue(adapter)).resolves.toEqual([]);
  });

  it('records its own claim while the rating is in flight and releases it on a retryable failure', async () => {
    const adapter = await openDatabaseWithRating();
    const held = fakeBridge.queueDeferredResponse();
    const before = Date.now();
    const drain = drainSeasonRatingQueue(adapter);
    await waitForRequestCount(fakeBridge, 1);

    const [inFlight] = await readQueue(adapter);
    held.release({ status: 500, body: { error: 'boom' } });
    await drain;

    expect(inFlight.status).toBe('syncing');
    expect(inFlight.claim_owner).toBe('js');
    expect(inFlight.claimed_at).toBeGreaterThanOrEqual(before);
    await expect(readQueue(adapter)).resolves.toEqual([
      { status: 'pending', claim_owner: null, claimed_at: null },
    ]);
  });

  it('never overwrites a row the other runtime took over after this claim was lost', async () => {
    const adapter = await openDatabaseWithRating();
    const held = fakeBridge.queueDeferredResponse();
    const drain = drainSeasonRatingQueue(adapter);
    await waitForRequestCount(fakeBridge, 1);

    const takenOver = { status: 'syncing', claim_owner: 'native', claimed_at: Date.now() };
    await setClaim(adapter, takenOver);
    held.release({ status: 500, body: { error: 'boom' } });
    await drain;

    await expect(readQueue(adapter)).resolves.toEqual([takenOver]);
  });
});
