/**
 * The active-season refresh generation shared by every refresher (the season hook and the
 * dispatched cycle). Starting a refresh or clearing the season moves it forward, so a refresh whose
 * fetch answers after a newer one, or after a clear, publishes and caches nothing.
 */
export const ACTIVE_SEASON_REFRESH_GENERATION = { current: 0 };
