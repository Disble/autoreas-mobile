export type SeasonRatingQueueStatus = 'pending' | 'syncing' | 'failed';

export type SeasonRatingFailureKind =
  | 'auth_repair'
  | 'conflict'
  | 'not_found'
  | 'unexpected_response'
  | 'unreachable';

export type SeasonRatingDeliveryState = 'pending' | 'confirmed' | 'failed';

export interface CreateSeasonRatingQueueEntryInput {
  readonly seasonId: string;
  readonly animeId: string;
  readonly nota: number;
  readonly ratedAt: number;
}

export interface SeasonRatingQueueEntry {
  readonly seasonId: string;
  readonly animeId: string;
  readonly nota: number;
  readonly ratedAt: number;
  readonly status: SeasonRatingQueueStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAttemptAt: number | null;
  readonly lastFailureKind: SeasonRatingFailureKind | null;
}

export interface SeasonRatingQueueClock {
  readonly now: () => number;
}

export interface ResolveSeasonRatingDeliveryInput {
  readonly status?: number;
  readonly error?: unknown;
}

export interface SeasonRatingDeliveryResolution {
  readonly state: SeasonRatingDeliveryState;
  readonly nextQueueStatus: SeasonRatingQueueStatus | null;
  readonly shouldKeepEntry: boolean;
  readonly shouldRetry: boolean;
  readonly failureKind: SeasonRatingFailureKind | null;
}
