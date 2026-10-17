/**
 * The `operation_log.operation` of an anime edit (ADR 009 R-3): the only kind the reconcile
 * carries, and the only kind that means "this anime has a local edit the bridge has not
 * confirmed" to the merge, the heal, fetch-first and anime-key resolution.
 */
export const ANIME_UPDATE_OPERATION = 'update';

/**
 * The `operation_log.operation` of a season rating (L20, L28): queued under its anime, sent
 * through its own bridge endpoint, never through the reconcile.
 */
export const SEASON_RATING_OPERATION = 'season_rating';
