/** Defines the data contract for use web socket props. */
export interface UseWebSocketProps {
  readonly enabled?: boolean;
  readonly onSyncRequired?: () => void;
  /**
   * Fires on every open of a connection session except a first attempt that succeeds (ADR 009
   * R-7): the mount or resume flush that enabled the socket already covers that one. An open after
   * failed attempts (a bridge that was down at mount) is a reconnect.
   */
  readonly onReconnected?: () => void;
  /**
   * Fires when a socket that opened closes while the socket is still wanted (ADR 009 R-9), so the
   * runtime can re-check the bridge through a cycle. A drop does not prove HTTP is down, so this
   * reports the drop only. A socket that never opened, and a close the hook causes itself
   * (unmount, disable), are not reported.
   */
  readonly onDisconnected?: () => void;
}
