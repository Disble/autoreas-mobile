import type { SQLiteDatabase } from 'expo-sqlite';
import {
  drainSeasonRatingQueue,
  enqueueSeasonRatingIntent,
} from '../../../src/features/sync/season-rating-queue.helpers';
import { installFakeBridge } from '../../support/fake-bridge.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// The ONLY production module mocked here, and only to hand drizzle a node:sqlite handle
// instead of expo-sqlite. The queue helpers, the write door and the bridgeClient singleton
// all run for real.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

/** One `season_rating_queue` row as read back from the real database. */
interface StoredQueueRow {
  anime_id: string;
  nota: number;
  status: string;
  last_failure_kind: string | null;
}

/** Opens a migrated database already paired with a bridge. */
async function openPairedDatabase(): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id) VALUES (1, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
  );

  return adapter;
}

/** Reads the whole season-rating queue, ordered for stable assertions. */
async function readQueue(adapter: SQLiteDatabase): Promise<StoredQueueRow[]> {
  return adapter.getAllAsync<StoredQueueRow>(
    'SELECT anime_id, nota, status, last_failure_kind FROM season_rating_queue ORDER BY id ASC',
  );
}

describe('season rating survives the round trip to the bridge', () => {
  let fakeBridge: FakeBridge;

  beforeEach(() => {
    fakeBridge = installFakeBridge();
  });

  afterEach(() => {
    fakeBridge.restore();
  });

  it('persists the rating intent before any delivery is attempted', async () => {
    const adapter = await openPairedDatabase();

    await enqueueSeasonRatingIntent(adapter, {
      seasonId: 'season-1',
      animeId: 'anime-1',
      nota: 8,
      ratedAt: 1_700_000_000_000,
    });

    // Intent is durable from the first write, so a rating survives the app dying before delivery.
    expect(await readQueue(adapter)).toEqual([
      { anime_id: 'anime-1', nota: 8, status: 'pending', last_failure_kind: null },
    ]);
    expect(fakeBridge.requests).toHaveLength(0);
  });

  it('clears the queued row only once the bridge confirms with a 204', async () => {
    const adapter = await openPairedDatabase();
    await enqueueSeasonRatingIntent(adapter, {
      seasonId: 'season-1',
      animeId: 'anime-1',
      nota: 8,
      ratedAt: 1_700_000_000_000,
    });
    fakeBridge.queueResponse({ status: 204, body: null });

    const result = await drainSeasonRatingQueue(adapter);

    expect(result.deliveredCount).toBe(1);
    expect(fakeBridge.requests).toHaveLength(1);
    expect(fakeBridge.requests[0].method).toBe('POST');
    expect(await readQueue(adapter)).toEqual([]);
  });

  it('keeps the row pending and retryable when the bridge fails', async () => {
    const adapter = await openPairedDatabase();
    await enqueueSeasonRatingIntent(adapter, {
      seasonId: 'season-1',
      animeId: 'anime-1',
      nota: 8,
      ratedAt: 1_700_000_000_000,
    });
    fakeBridge.queueResponse({ status: 500, body: { error: 'boom' } });

    const result = await drainSeasonRatingQueue(adapter);

    // A server failure must never discard the user's rating; it stays queued for the next drain.
    expect(result.deliveredCount).toBe(0);
    expect(await readQueue(adapter)).toEqual([
      { anime_id: 'anime-1', nota: 8, status: 'pending', last_failure_kind: 'unexpected_response' },
    ]);
  });

  it('drops the row on a terminal 404 rather than retrying it forever', async () => {
    const adapter = await openPairedDatabase();
    await enqueueSeasonRatingIntent(adapter, {
      seasonId: 'season-1',
      animeId: 'anime-gone',
      nota: 5,
      ratedAt: 1_700_000_000_000,
    });
    fakeBridge.queueResponse({ status: 404, body: { error: 'not found' } });

    const result = await drainSeasonRatingQueue(adapter);

    expect(result.deliveredCount).toBe(0);
    expect(await readQueue(adapter)).toEqual([]);
  });

  it('does nothing at all when no bridge is paired', async () => {
    const adapter = createTestSqliteAdapter();
    await applyMigrationFiles(adapter);
    await enqueueSeasonRatingIntent(adapter, {
      seasonId: 'season-1',
      animeId: 'anime-1',
      nota: 8,
      ratedAt: 1_700_000_000_000,
    });

    const result = await drainSeasonRatingQueue(adapter);

    // No config means no attempt -- and critically, the intent is not discarded.
    expect(result).toMatchObject({ deliveredCount: 0, backlogReadCount: 0 });
    expect(fakeBridge.requests).toHaveLength(0);
    expect(await readQueue(adapter)).toHaveLength(1);
  });
});
