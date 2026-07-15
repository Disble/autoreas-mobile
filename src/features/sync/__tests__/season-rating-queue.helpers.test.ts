import type { SQLiteDatabase } from 'expo-sqlite';
import { BridgeUnreachableError, bridgeClient } from '../../../infrastructure/api';
import {
  getBridgeConfigSnapshot,
  withDeferredWrite,
} from '../../../infrastructure/db/client';
import {
  createSeasonRatingQueueEntry,
  drainSeasonRatingQueue,
  enqueueSeasonRatingIntent,
  markSeasonRatingQueueEntrySyncing,
  resolveSeasonRatingDelivery,
} from '../season-rating-queue.helpers';

jest.mock('../../../infrastructure/api', () => {
  const actual = jest.requireActual('../../../infrastructure/api');

  return {
    ...actual,
    bridgeClient: {
      ...actual.bridgeClient,
      postActiveSeasonRating: jest.fn(),
    },
  };
});

jest.mock('../../../infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  withDeferredWrite: jest.fn(),
}));

describe('season rating queue helpers', () => {
  const rawDb = {
    getAllAsync: jest.fn(),
    runAsync: jest.fn(),
  } as unknown as SQLiteDatabase;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a pending entry while preserving the original ratedAt timestamp', () => {
    const entry = createSeasonRatingQueueEntry(
      {
        seasonId: 'season-2026-q3',
        animeId: 'anime-1',
        nota: 6,
        ratedAt: 1_752_000_000_000,
      },
      { now: () => 1_752_000_100_000 },
    );

    expect(entry).toEqual({
      seasonId: 'season-2026-q3',
      animeId: 'anime-1',
      nota: 6,
      ratedAt: 1_752_000_000_000,
      status: 'pending',
      createdAt: 1_752_000_100_000,
      updatedAt: 1_752_000_100_000,
      lastAttemptAt: null,
      lastFailureKind: null,
    });
  });

  it('marks a queued entry as syncing without mutating the original ratedAt value', () => {
    const pendingEntry = createSeasonRatingQueueEntry(
      {
        seasonId: 'season-2026-q3',
        animeId: 'anime-2',
        nota: 4,
        ratedAt: 1_752_100_000_000,
      },
      { now: () => 1_752_100_100_000 },
    );

    const syncingEntry = markSeasonRatingQueueEntrySyncing(pendingEntry, {
      now: () => 1_752_100_200_000,
    });

    expect(syncingEntry.status).toBe('syncing');
    expect(syncingEntry.lastAttemptAt).toBe(1_752_100_200_000);
    expect(syncingEntry.updatedAt).toBe(1_752_100_200_000);
    expect(syncingEntry.ratedAt).toBe(1_752_100_000_000);
  });

  it('treats unreachable delivery as a retryable pending state', () => {
    const resolution = resolveSeasonRatingDelivery({
      error: new BridgeUnreachableError('http://bridge.test/api/seasons/active/ratings', 'offline'),
    });

    expect(resolution).toEqual({
      state: 'pending',
      nextQueueStatus: 'pending',
      shouldKeepEntry: true,
      shouldRetry: true,
      failureKind: 'unreachable',
    });
  });

  it('classifies 204 as confirmed clear and 404/409 as terminal drops', () => {
    expect(resolveSeasonRatingDelivery({ status: 204 })).toEqual({
      state: 'confirmed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: null,
    });

    expect(resolveSeasonRatingDelivery({ status: 404 })).toEqual({
      state: 'failed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: 'not_found',
    });

    expect(resolveSeasonRatingDelivery({ status: 409 })).toEqual({
      state: 'failed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: 'conflict',
    });
  });

  it('keeps 401 entries for repair without auto-retrying them', () => {
    const resolution = resolveSeasonRatingDelivery({ status: 401 });

    expect(resolution).toEqual({
      state: 'failed',
      nextQueueStatus: 'failed',
      shouldKeepEntry: true,
      shouldRetry: false,
      failureKind: 'auth_repair',
    });
  });

  it('posts a queued season rating through BridgeClient and removes it on 204', async () => {
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
    (withDeferredWrite as jest.Mock).mockImplementation(
      async (_database: SQLiteDatabase, task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>) =>
        task({}, rawDb),
    );
    (rawDb.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: 7,
        season_id: 'season-2026-q3',
        anime_id: 'anime-7',
        nota: 6,
        rated_at: 1_752_000_000_000,
        status: 'pending',
        created_at: 1_752_000_100_000,
        updated_at: 1_752_000_100_000,
        last_attempt_at: null,
        last_failure_kind: null,
      },
    ]);
    (bridgeClient.postActiveSeasonRating as jest.Mock).mockResolvedValue({
      ok: true,
      status: 204,
      data: null,
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active/ratings',
    });

    const result = await drainSeasonRatingQueue(rawDb, {
      now: () => 1_752_000_200_000,
    });

    expect(bridgeClient.postActiveSeasonRating).toHaveBeenCalledWith(
      {
        ip: '127.0.0.1',
        port: 8080,
        token: 'bridge-token',
      },
      {
        animeId: 'anime-7',
        nota: 6,
        ratedAt: 1_752_000_000_000,
      },
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE season_rating_queue'),
      'syncing',
      1_752_000_200_000,
      1_752_000_200_000,
      null,
      7,
    );
    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM season_rating_queue'),
      7,
    );
    expect(result).toEqual({
      deliveredCount: 1,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: true,
    });
  });

  it('persists a durable season rating intent before any sync attempt', async () => {
    (withDeferredWrite as jest.Mock).mockImplementation(
      async (
        _database: SQLiteDatabase,
        task: (db: { insert: jest.Mock }, tx: SQLiteDatabase) => Promise<unknown>,
      ) => {
        const insert = jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) }));
        return task({ insert }, rawDb);
      },
    );

    const entry = await enqueueSeasonRatingIntent(
      rawDb,
      {
        seasonId: 'season-2026-q3',
        animeId: 'anime-4',
        nota: 5,
        ratedAt: 1_752_300_000_000,
      },
      { now: () => 1_752_300_100_000 },
    );

    expect(withDeferredWrite).toHaveBeenCalledTimes(1);
    expect(entry).toEqual({
      seasonId: 'season-2026-q3',
      animeId: 'anime-4',
      nota: 5,
      ratedAt: 1_752_300_000_000,
      status: 'pending',
      createdAt: 1_752_300_100_000,
      updatedAt: 1_752_300_100_000,
      lastAttemptAt: null,
      lastFailureKind: null,
    });
  });

  it('keeps retryable unreachable ratings durable as pending', async () => {
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
    (withDeferredWrite as jest.Mock).mockImplementation(
      async (_database: SQLiteDatabase, task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>) =>
        task({}, rawDb),
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
    (bridgeClient.postActiveSeasonRating as jest.Mock).mockRejectedValue(
      new BridgeUnreachableError('http://127.0.0.1:8080/api/seasons/active/ratings', 'offline'),
    );

    const result = await drainSeasonRatingQueue(rawDb, {
      now: () => 1_752_100_200_000,
    });

    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE season_rating_queue'),
      'pending',
      1_752_100_200_000,
      1_752_100_200_000,
      'unreachable',
      9,
    );
    expect(result).toEqual({
      deliveredCount: 0,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: false,
    });
  });

  it('drops stale queued ratings on 404 and requests an active-season refresh', async () => {
    (getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      ip: '127.0.0.1',
      port: 8080,
      token: 'bridge-token',
    });
    (withDeferredWrite as jest.Mock).mockImplementation(
      async (_database: SQLiteDatabase, task: (db: unknown, tx: SQLiteDatabase) => Promise<unknown>) =>
        task({}, rawDb),
    );
    (rawDb.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: 12,
        season_id: 'season-2026-q3',
        anime_id: 'anime-12',
        nota: 2,
        rated_at: 1_752_200_000_000,
        status: 'pending',
        created_at: 1_752_200_100_000,
        updated_at: 1_752_200_100_000,
        last_attempt_at: null,
        last_failure_kind: null,
      },
    ]);
    (bridgeClient.postActiveSeasonRating as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      data: null,
      rawBody: null,
      url: 'http://127.0.0.1:8080/api/seasons/active/ratings',
    });

    const result = await drainSeasonRatingQueue(rawDb, {
      now: () => 1_752_200_200_000,
    });

    expect(rawDb.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM season_rating_queue'),
      12,
    );
    expect(result).toEqual({
      deliveredCount: 0,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: true,
    });
  });
});
