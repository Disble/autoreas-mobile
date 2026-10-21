import type { UseSyncFacadeResult } from './sync-facade.types';

/** Defines the sync visible status tone value shape. */
export type SyncVisibleStatusTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/**
 * Names which branch produced a sync visible status, so surfaces can pick a glyph or gate an alert
 * without matching on copy. `waiting` is a backlog under the stale threshold; `stale` is the same
 * backlog after it, the only one that escalates to `warning`.
 */
export type SyncVisibleStatusKind =
  | 'local'
  | 'offline'
  | 'idle'
  | 'queued'
  | 'waiting'
  | 'stale'
  | 'syncing'
  | 'synced'
  | 'rejected';

/** Defines the data contract for sync visible status facts. */
export interface SyncVisibleStatusFacts {
  readonly connectionStatus: UseSyncFacadeResult['connectionStatus'];
  readonly isBridgeConfigured?: boolean;
  readonly isDeviceOnline?: boolean | null;
  readonly lastSyncAt: number | null;
  readonly pendingOpsCount: number;
}

/** Defines the data contract for sync visible status. */
export interface SyncVisibleStatus {
  readonly chipLabel: string;
  readonly description: string;
  readonly kind: SyncVisibleStatusKind;
  readonly title: string;
  readonly tone: SyncVisibleStatusTone;
}
