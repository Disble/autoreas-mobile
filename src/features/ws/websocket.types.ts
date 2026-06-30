export interface UseWebSocketProps {
  readonly enabled?: boolean;
  readonly onSyncRequired?: () => void;
  readonly onPreferencesChanged?: (seasonMode: boolean) => void;
}
