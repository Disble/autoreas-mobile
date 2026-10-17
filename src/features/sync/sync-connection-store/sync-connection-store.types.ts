/** Defines the shared foreground sync connection status. */
export type SyncConnectionStatus =
  | 'idle'
  | 'syncing'
  | 'online'
  | 'unreachable'
  | 'sync_error';

/**
 * Defines the latest JS evidence about the bridge (ADR 009 R-9): when the last settled exchange
 * happened and whether it reached the bridge. Only a transport failure records `reached: false`.
 */
export interface SyncBridgeContact {
  readonly at: number;
  readonly reached: boolean;
}

/** Defines the immutable shared foreground sync snapshot. */
export interface SyncConnectionSnapshot {
  readonly kind: SyncConnectionStatus;
  readonly lastSyncAt: number | null;
  readonly message: string | null;
  /** The latest exchange's reachability evidence, or `null` before any (or after unpairing). */
  readonly bridgeContact: SyncBridgeContact | null;
}

/** Defines the coordinated terminal publication for one authoritative sync attempt. */
export interface SyncConnectionAttemptPublication {
  readonly attempt: number;
  readonly persistTelemetry: () => Promise<void>;
  readonly publishConnection: () => void;
}
