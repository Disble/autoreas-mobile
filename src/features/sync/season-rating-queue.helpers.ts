import { BridgeUnreachableError } from '../../infrastructure/api';
import type {
  CreateSeasonRatingQueueEntryInput,
  ResolveSeasonRatingDeliveryInput,
  SeasonRatingDeliveryResolution,
  SeasonRatingQueueClock,
  SeasonRatingQueueEntry,
} from './season-rating-queue.types';

const defaultQueueClock: SeasonRatingQueueClock = {
  now: () => Date.now(),
};

/**
 * Creates a durable season-rating queue entry that preserves the original user rating timestamp.
 * This keeps offline intent separate from confirmed bridge truth from the very first write.
 */
export function createSeasonRatingQueueEntry(
  input: CreateSeasonRatingQueueEntryInput,
  clock: SeasonRatingQueueClock = defaultQueueClock,
): SeasonRatingQueueEntry {
  const now = clock.now();

  return {
    seasonId: input.seasonId,
    animeId: input.animeId,
    nota: input.nota,
    ratedAt: input.ratedAt,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    lastAttemptAt: null,
    lastFailureKind: null,
  };
}

/**
 * Marks one queue entry as actively syncing while preserving the immutable rating intent fields.
 * The runtime can use this transition to distinguish backlog rows from in-flight delivery attempts.
 */
export function markSeasonRatingQueueEntrySyncing(
  entry: SeasonRatingQueueEntry,
  clock: SeasonRatingQueueClock = defaultQueueClock,
): SeasonRatingQueueEntry {
  const now = clock.now();

  return {
    ...entry,
    status: 'syncing',
    updatedAt: now,
    lastAttemptAt: now,
    lastFailureKind: null,
  };
}

/**
 * Classifies one season-rating delivery attempt into retryable, confirmed, or terminal semantics.
 * The branch table keeps season ratings independent from anime reconcile status handling.
 */
export function resolveSeasonRatingDelivery(
  input: ResolveSeasonRatingDeliveryInput,
): SeasonRatingDeliveryResolution {
  if (input.error instanceof BridgeUnreachableError) {
    return {
      state: 'pending',
      nextQueueStatus: 'pending',
      shouldKeepEntry: true,
      shouldRetry: true,
      failureKind: 'unreachable',
    };
  }

  if (input.status === 204) {
    return {
      state: 'confirmed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: null,
    };
  }

  if (input.status === 404) {
    return {
      state: 'failed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: 'not_found',
    };
  }

  if (input.status === 409) {
    return {
      state: 'failed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: 'conflict',
    };
  }

  if (input.status === 401) {
    return {
      state: 'failed',
      nextQueueStatus: 'failed',
      shouldKeepEntry: true,
      shouldRetry: false,
      failureKind: 'auth_repair',
    };
  }

  return {
    state: 'pending',
    nextQueueStatus: 'pending',
    shouldKeepEntry: true,
    shouldRetry: true,
    failureKind: input.status ? 'unexpected_response' : null,
  };
}
