import type { UseSyncFacadeResult } from './sync-facade.types';

/** Defines the sync visible status tone value shape. */
export type SyncVisibleStatusTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/** Defines the data contract for sync visible status facts. */
export interface SyncVisibleStatusFacts {
  readonly connectionStatus: UseSyncFacadeResult['connectionStatus'];
  readonly isBridgeConfigured?: boolean;
  readonly isDeviceOnline?: boolean | null;
  readonly lastSyncAt: number | null;
  readonly pendingOpsCount: number;
  readonly syncError: string | null;
}

/** Defines the data contract for sync visible status. */
export interface SyncVisibleStatus {
  readonly chipLabel: string;
  readonly description: string;
  readonly title: string;
  readonly tone: SyncVisibleStatusTone;
}
