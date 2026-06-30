import type { UseSyncFacadeResult } from './sync-facade.types';

export type SyncVisibleStatusTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

export interface SyncVisibleStatusFacts {
  readonly connectionStatus: UseSyncFacadeResult['connectionStatus'];
  readonly isBridgeConfigured?: boolean;
  readonly isDeviceOnline?: boolean | null;
  readonly lastSyncAt: number | null;
  readonly pendingOpsCount: number;
  readonly syncError: string | null;
}

export interface SyncVisibleStatus {
  readonly chipLabel: string;
  readonly description: string;
  readonly title: string;
  readonly tone: SyncVisibleStatusTone;
}
