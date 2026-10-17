/** The epoch ms the first seeded outbox row was queued at; later rows add one ms each. */
export const FIRST_ROW_AT = 1_700_000_000_000;


/**
 * A valid active-season answer: what the refresh after a resume (`app_active`) or a season event
 * reads (ADR 009 I8, L28).
 */
export const ACTIVE_SEASON_ANSWER = {
  status: 200,
  body: { season_id: 'season-2', candidates: [{ anime_id: 'anime-1', grade: null, grade_source: null }] },
};
