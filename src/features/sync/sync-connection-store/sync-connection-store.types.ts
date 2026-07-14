/** Defines the shared foreground sync connection status. */
export type SyncConnectionStatus =
  | 'idle'
  | 'syncing'
  | 'online'
  | 'unreachable'
  | 'sync_error';

/** Defines the immutable shared foreground sync snapshot. */
export interface SyncConnectionSnapshot {
  readonly kind: SyncConnectionStatus;
  readonly lastSyncAt: number | null;
  readonly message: string | null;
}

/** Defines the coordinated terminal publication for one authoritative sync attempt. */
export interface SyncConnectionAttemptPublication {
  readonly attempt: number;
  readonly persistTelemetry: () => Promise<void>;
  readonly publishConnection: () => void;
}
