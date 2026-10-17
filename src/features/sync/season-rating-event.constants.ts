import type { SeasonRatingClock, SettledRating } from './season-rating-event.types';

/** Provides the production clock used to timestamp queued season ratings. */
export const DEFAULT_SEASON_RATING_CLOCK: SeasonRatingClock = {
  now: () => Date.now(),
};


/** A settled rating that wrote nothing confirmed: the claim no longer held it, or its answer did not confirm it. */
export const NOTHING_CONFIRMED: SettledRating = { confirmed: false, successors: [], resolutions: [] };
