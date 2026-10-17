import type { OperationLogRow } from '../../infrastructure/db/schema';
import type { AutomaticResolution } from './unresolved-key.types';

/**
 * Why the bridge rejected a season rating (ADR 009 R-5): stored as the row's `unresolved_reason`
 * when it becomes `dead_letter`.
 */
export type SeasonRatingFailureKind = 'auth_repair' | 'conflict' | 'not_found' | 'rejected';

/** What one rating answer means for its row; mirrors Kotlin `SeasonRatingFate`. */
export type SeasonRatingFate =
  | { readonly kind: 'delivered' }
  | { readonly kind: 'given_up'; readonly reason: SeasonRatingFailureKind }
  | { readonly kind: 'pending' };

/** One season rating the user made, before it is queued. */
export interface SeasonRatingIntentInput {
  readonly seasonId: string;
  readonly animeId: string;
  readonly nota: number;
  readonly ratedAt: number;
}

/**
 * The stored payload of a `season_rating` row (L28). Read leniently: the column is free-form TEXT,
 * so a field may be missing or of another type, and it is passed on as stored, never guessed.
 */
export interface SeasonRatingPayload {
  readonly seasonId?: unknown;
  readonly grade?: unknown;
  readonly ratedAt?: unknown;
}

/** The status a queued rating shows: waiting, in flight, or given up. */
export type SeasonRatingIntentStatus = 'pending' | 'syncing' | 'failed';

/** One queued rating as the season projection reads it. */
export interface SeasonRatingIntent {
  readonly id: number;
  readonly animeId: string;
  readonly seasonId: string;
  readonly nota: number;
  readonly ratedAt: number;
  readonly createdAt: number;
  readonly status: SeasonRatingIntentStatus;
  readonly failureKind: SeasonRatingFailureKind | null;
}

/** Defines the data contract for the clock that timestamps queued ratings. */
export interface SeasonRatingClock {
  readonly now: () => number;
}

/** What one rating pass did within a round. */
export interface SeasonRatingRoundOutcome {
  /** Ratings the bridge confirmed while this claim still held them. */
  readonly confirmedCount: number;
  /** Ratings left `pending`: a retryable answer or a failed local write. */
  readonly pendingCount: number;
  /** Ratings this claim still held and posted. */
  readonly attemptedCount: number;
  /** A delivery, a 404 or a 409 changed what the active-season snapshot should show. */
  readonly shouldRefreshActiveSeason: boolean;
  /** The next row of every key whose rating was confirmed, already claimed. */
  readonly successors: readonly OperationLogRow[];
}

/** What settling one rating wrote: whether it was confirmed here, and the successors it claimed. */
export interface SettledRating {
  readonly confirmed: boolean;
  readonly successors: readonly OperationLogRow[];
  readonly resolutions: readonly AutomaticResolution[];
}
