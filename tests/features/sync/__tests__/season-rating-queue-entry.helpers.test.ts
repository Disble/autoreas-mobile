import { BridgeUnreachableError } from '../../../../src/infrastructure/api';
import {
  createSeasonRatingQueueEntry,
  markSeasonRatingQueueEntrySyncing,
  resolveSeasonRatingDelivery,
} from '../../../../src/features/sync/season-rating-queue.helpers';

describe('season rating queue entry helpers', () => {
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
});
