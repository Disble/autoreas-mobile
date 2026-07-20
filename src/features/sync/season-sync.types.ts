/** Defines the data contract for use season sync props. */
export interface UseSeasonSyncProps {
  readonly enabled: boolean;
}

/** Defines the data contract for use season sync result. */
export interface UseSeasonSyncResult {
  readonly clearActiveSeason: () => Promise<void>;
  readonly isRefreshing: boolean;
  readonly refreshActiveSeason: () => Promise<void>;
}
