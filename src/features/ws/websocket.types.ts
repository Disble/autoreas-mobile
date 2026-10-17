/** Defines the data contract for use web socket props. */
export interface UseWebSocketProps {
  readonly enabled?: boolean;
  readonly onSeasonChanged?: () => void;
  readonly onSyncRequired?: () => void;
  readonly onPreferencesChanged?: (seasonMode: boolean) => void;
  /**
   * Fires on every open after the first one of a connection session (ADR 009 R-7). The first
   * open is never a reconnect: the mount or resume flush that enabled the socket already covers it.
   */
  readonly onReconnected?: () => void;
}
