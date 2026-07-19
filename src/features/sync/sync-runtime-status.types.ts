import type { SyncExecutionMode } from './sync-execution-mode.types';

/** Defines the sync runtime registration status value shape. */
export type SyncRuntimeRegistrationStatus = 'registered' | 'unregistered' | 'unsupported';

/** Defines the sync runtime trigger source value shape. */
export type SyncRuntimeTriggerSource =
  | 'bootstrap'
  | 'manual'
  | 'app_active'
  | 'network_regained'
  | 'local_mutation'
  | 'ws_sync_required'
  | 'foreground_service'
  | 'background_task';

/** Defines the data contract for sync runtime status snapshot. */
export interface SyncRuntimeStatusSnapshot {
  readonly registrationStatus: SyncRuntimeRegistrationStatus;
  readonly executionMode: SyncExecutionMode;
  readonly isForegroundServiceRunning: boolean;
  readonly canShowPersistentNotification: boolean;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureMessage: string | null;
  readonly lastTriggerSource: SyncRuntimeTriggerSource | null;
  readonly lastSyncedCount: number;
  readonly isCycleActive: boolean;
  readonly lastBacklogReadCount: number;
  readonly lastPrunedOperationsCount: number;
  readonly isBackgroundTaskRegistered: boolean;
}

/** Defines the data contract for sync runtime status patch. */
export interface SyncRuntimeStatusPatch {
  readonly registrationStatus?: SyncRuntimeRegistrationStatus;
  readonly executionMode?: SyncExecutionMode;
  readonly isForegroundServiceRunning?: boolean;
  readonly canShowPersistentNotification?: boolean;
  readonly lastAttemptAt?: number | null;
  readonly lastSuccessAt?: number | null;
  readonly lastFailureMessage?: string | null;
  readonly lastTriggerSource?: SyncRuntimeTriggerSource | null;
  readonly lastSyncedCount?: number;
  readonly isCycleActive?: boolean;
  readonly lastBacklogReadCount?: number;
  readonly lastPrunedOperationsCount?: number;
  readonly isBackgroundTaskRegistered?: boolean;
}
