export interface UseSeasonSyncProps {
  readonly enabled: boolean;
}

export interface UseSeasonSyncResult {
  readonly isRefreshing: boolean;
  readonly refreshActiveSeason: () => Promise<void>;
}
