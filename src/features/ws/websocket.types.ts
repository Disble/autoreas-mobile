export interface UseWebSocketProps {
  readonly enabled?: boolean;
  readonly onSeasonChanged?: () => void;
  readonly onSyncRequired?: () => void;
  readonly onPreferencesChanged?: (seasonMode: boolean) => void;
}
