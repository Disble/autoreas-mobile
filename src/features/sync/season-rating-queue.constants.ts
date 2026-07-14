import type { SeasonRatingQueueClock } from './season-rating-queue.types';

/** Provides the production clock used to timestamp season-rating queue entries. */
export const DEFAULT_SEASON_RATING_QUEUE_CLOCK: SeasonRatingQueueClock = {
  now: Date.now,
};
