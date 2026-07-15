import type { SQLiteDatabase } from 'expo-sqlite';
import { BridgeUnreachableError, bridgeClient } from '../../../src/infrastructure/api';
import {
  getBridgeConfigSnapshot,
  withDeferredWrite,
} from '../../../src/infrastructure/db/client';
import {
  drainSeasonRatingQueue,
  enqueueSeasonRatingIntent,
} from '../../../src/features/sync/season-rating-queue.helpers';
import {
  beginSyncConnectionAttempt,
  getSyncConnectionSnapshot,
  markSyncConnectionSucceeded,
  resetSyncConnectionStore,
} from '../../../src/features/sync/sync-connection-store';

jest.mock('../../../src/infrastructure/api', () => {
  const actual = jest.requireActual('../../../src/infrastructure/api');

  return {
    ...actual,
    bridgeClient: {
      ...actual.bridgeClient,
      postActiveSeasonRating: jest.fn(),
    },
  };
});

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withDeferredWrite: jest.fn(),
}));

describe('drainSeasonRatingQueue', () => {
  const rawDb = {
    getAllAsync: jest.fn(),
    runAsync: jest.fn(),
  } as unknown as SQLiteDatabase;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
    (withDeferredWrite as jest.Mock).mockImplementation(
      async (
        _database: SQLiteDatabase,
        task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>,
      ) => task({}, rawDb),
    );
    (rawDb.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: 9,
        season_id: 'season-2026-q3',
        anime_id: 'anime-9',
        nota: 4,
        rated_at: 1_752_100_000_000,
        status: 'pending',
        created_at: 1_752_100_100_000,
        updated_at: 1_752_100_100_000,
        last_attempt_at: null,
        last_failure_kind: null,
      },
    ]);
  });

  it('invalidates prior online truth as soon as durable season work is enqueued', async () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    (withDeferredWrite as jest.Mock).mockImplementation(
      async (
        _database: SQLiteDatabase,
        task: (db: { insert: jest.Mock }, tx: SQLiteDatabase) => Promise<unknown>,
      ) => {
        const insert = jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) }));
        return task({ insert }, rawDb);
      },
    );

    await enqueueSeasonRatingIntent(rawDb, {
      seasonId: 'season-2026-q3',
      animeId: 'anime-1',
      nota: 5,
      ratedAt: 1_752_100_000_000,
    });

    expect(getSyncConnectionSnapshot().kind).toBe('idle');
  });

  it('exposes the unreachable failure while keeping the rating queued', async () => {
    const unreachableError = new BridgeUnreachableError(
      'http://127.0.0.1:8080/api/seasons/active/rating',
      'offline',
    );
    (bridgeClient.postActiveSeasonRating as jest.Mock).mockRejectedValue(unreachableError);

    const result = await drainSeasonRatingQueue(rawDb, {
      now: () => 1_752_100_200_000,
    });

    expect(rawDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE status IN ('pending', 'syncing', 'failed')"),
    );
    expect(result.failure).toBe(unreachableError);
    expect(rawDb.runAsync).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE season_rating_queue'),
      'pending',
      1_752_100_200_000,
      1_752_100_200_000,
      'unreachable',
      9,
    );
  });

  it('reports a reachable auth rejection as incomplete sync_error work', async () => {
    (bridgeClient.postActiveSeasonRating as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      data: null,
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active/rating',
    });

    const result = await drainSeasonRatingQueue(rawDb, {
      now: () => 1_752_100_200_000,
    });

    expect(result.failure).toEqual(
      new Error('Season rating delivery incomplete: auth_repair'),
    );
    expect(result.failure).not.toBeInstanceOf(BridgeUnreachableError);
    expect(rawDb.runAsync).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE season_rating_queue'),
      'failed',
      1_752_100_200_000,
      1_752_100_200_000,
      'auth_repair',
      9,
    );
  });

  it('preserves the first delivery failure while resolving later queue entries', async () => {
    const firstFailure = new BridgeUnreachableError(
      'http://127.0.0.1:8080/api/seasons/active/rating',
      'offline',
    );
    (rawDb.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: 9,
        season_id: 'season-2026-q3',
        anime_id: 'anime-9',
        nota: 4,
        rated_at: 1_752_100_000_000,
        status: 'pending',
        created_at: 1_752_100_100_000,
        updated_at: 1_752_100_100_000,
        last_attempt_at: null,
        last_failure_kind: null,
      },
      {
        id: 10,
        season_id: 'season-2026-q3',
        anime_id: 'anime-10',
        nota: 5,
        rated_at: 1_752_100_010_000,
        status: 'pending',
        created_at: 1_752_100_110_000,
        updated_at: 1_752_100_110_000,
        last_attempt_at: null,
        last_failure_kind: null,
      },
    ]);
    (bridgeClient.postActiveSeasonRating as jest.Mock)
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        data: null,
        rawBody: null,
        url: 'http://127.0.0.1:8080/api/seasons/active/rating',
      });

    const result = await drainSeasonRatingQueue(rawDb, {
      now: () => 1_752_100_200_000,
    });

    expect(result).toEqual({
      deliveredCount: 0,
      backlogReadCount: 2,
      shouldRefreshActiveSeason: true,
      failure: firstFailure,
    });
    expect(rawDb.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM season_rating_queue'),
      10,
    );
  });

  it.each([
    [404, 'not_found'],
    [409, 'conflict'],
  ])(
    'deletes a terminal %s rating but returns reachable %s failure truth',
    async (status, failureKind) => {
      (bridgeClient.postActiveSeasonRating as jest.Mock).mockResolvedValue({
        ok: false,
        status,
        data: null,
        rawBody: null,
        url: 'http://127.0.0.1:8080/api/seasons/active/rating',
      });

      const result = await drainSeasonRatingQueue(rawDb, {
        now: () => 1_752_100_200_000,
      });

      expect(rawDb.runAsync).toHaveBeenLastCalledWith(
        expect.stringContaining('DELETE FROM season_rating_queue'),
        9,
      );
      expect(result).toEqual({
        deliveredCount: 0,
        backlogReadCount: 1,
        shouldRefreshActiveSeason: true,
        failure: new Error(`Season rating delivery incomplete: ${failureKind}`),
      });
      expect(result.failure).not.toBeInstanceOf(BridgeUnreachableError);
    },
  );
});
