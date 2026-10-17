import type { SQLiteDatabase } from 'expo-sqlite';
import { enqueueSeasonRatingIntent } from '../../../src/features/sync/season-rating-intent.helpers';
import {
  beginSyncConnectionAttempt,
  getSyncConnectionSnapshot,
  markSyncConnectionSucceeded,
  resetSyncConnectionStore,
} from '../../../src/features/sync/sync-connection-store';
import { requestFlush } from '../../../src/features/sync/sync-flush.helpers';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// Only the drizzle factory is swapped, so the write door runs for real on node:sqlite.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => () => Promise.resolve(),
  getOpenDatabaseSync: () => () => undefined,
  useOptionalSQLiteContext: () => null,
  useOptionalLiveQuery: (_query: unknown, fallback: unknown) => ({ data: fallback }),
}));

jest.mock('../../../src/features/sync/sync-flush.helpers', () => ({
  requestFlush: jest.fn().mockResolvedValue(0),
}));

/** Opens a migrated database. */
async function openDatabase(): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);

  return adapter;
}

describe('enqueueSeasonRatingIntent (ADR 009 R-1, I1; L28)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
  });

  it('queues the rating as a pending season_rating row of its anime, then asks for a flush', async () => {
    const adapter = await openDatabase();

    await enqueueSeasonRatingIntent(
      adapter,
      { seasonId: 'season-1', animeId: 'anime-1', nota: 5, ratedAt: 1_690_000_000_000 },
      { now: () => 1_700_000_000_000 },
    );

    expect(await adapter.getAllAsync('SELECT anime_id, operation, payload, status, created_at FROM operation_log')).toEqual([
      {
        anime_id: 'anime-1',
        operation: 'season_rating',
        payload: '{"seasonId":"season-1","grade":5,"ratedAt":1690000000000}',
        status: 'pending',
        created_at: 1_700_000_000_000,
      },
    ]);
    expect(requestFlush).toHaveBeenCalledWith(adapter, 'season_rating');
  });

  it('stamps the row with the real clock when the caller omits one', async () => {
    const adapter = await openDatabase();
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 5, ratedAt: 1 });

    expect(await adapter.getFirstAsync('SELECT created_at FROM operation_log')).toEqual({ created_at: 1_800_000_000_000 });
    jest.restoreAllMocks();
  });

  it('invalidates prior online truth as soon as the rating is queued', async () => {
    const adapter = await openDatabase();
    markSyncConnectionSucceeded(beginSyncConnectionAttempt(), 1_000);

    await enqueueSeasonRatingIntent(adapter, { seasonId: 'season-1', animeId: 'anime-1', nota: 5, ratedAt: 1 });

    expect(getSyncConnectionSnapshot().kind).toBe('idle');
  });
});
