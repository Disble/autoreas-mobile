/** Defines the season rating queue status value shape. */
export type SeasonRatingQueueStatus = 'pending' | 'syncing' | 'failed';

/** Defines the season rating failure kind value shape. */
export type SeasonRatingFailureKind =
  | 'auth_repair'
  | 'conflict'
  | 'not_found'
  | 'unexpected_response'
  | 'unreachable';

/** Defines the season rating delivery state value shape. */
export type SeasonRatingDeliveryState = 'pending' | 'confirmed' | 'failed';

/** Defines the data contract for create season rating queue entry input. */
export interface CreateSeasonRatingQueueEntryInput {
  readonly seasonId: string;
  readonly animeId: string;
  readonly nota: number;
  readonly ratedAt: number;
}

/** Defines the data contract for season rating queue entry. */
export interface SeasonRatingQueueEntry {
  readonly id?: number;
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

/** Defines the data contract for season rating queue clock. */
export interface SeasonRatingQueueClock {
  readonly now: () => number;
}

/** Defines the data contract for resolve season rating delivery input. */
export interface ResolveSeasonRatingDeliveryInput {
  readonly status?: number;
  readonly error?: unknown;
}

/** Defines the data contract for season rating delivery resolution. */
export interface SeasonRatingDeliveryResolution {
  readonly state: SeasonRatingDeliveryState;
  readonly nextQueueStatus: SeasonRatingQueueStatus | null;
  readonly shouldKeepEntry: boolean;
  readonly shouldRetry: boolean;
  readonly failureKind: SeasonRatingFailureKind | null;
}

/** Defines the data contract for drain season rating queue result. */
export interface DrainSeasonRatingQueueResult {
  readonly deliveredCount: number;
  readonly backlogReadCount: number;
  readonly shouldRefreshActiveSeason: boolean;
}
