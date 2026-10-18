/** The epoch ms the first seeded row was queued at; a row's id is added to it, so ids follow queue order. */
export const RATING_FIRST_ROW_AT = 1_700_000_000_000;

/** A rating of `anime-1` in `season-1`, the payload shape the enqueue writes (L28). */
export const RATING = { seasonId: 'season-1', grade: 5, ratedAt: 1_690_000_000_000 };

/** The rating body the bridge receives for {@link RATING}. */
export const RATING_BODY = { anime_id: 'anime-1', grade: 5, rated_at: 1_690_000_000_000, season_id: 'season-1' };
