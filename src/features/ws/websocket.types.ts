/** Defines the data contract for use web socket props. */
export interface UseWebSocketProps {
  readonly enabled?: boolean;
  readonly onSeasonChanged?: () => void;
  readonly onSyncRequired?: () => void;
  readonly onPreferencesChanged?: (seasonMode: boolean) => void;
}
