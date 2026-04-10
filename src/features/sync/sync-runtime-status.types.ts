export type SyncRuntimeRegistrationStatus = 'registered' | 'unregistered' | 'unsupported';

export type SyncRuntimeTriggerSource =
  | 'bootstrap'
  | 'manual'
  | 'app_active'
  | 'network_regained'
  | 'ws_sync_required'
  | 'background_task';

export interface SyncRuntimeStatusSnapshot {
  readonly registrationStatus: SyncRuntimeRegistrationStatus;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureMessage: string | null;
  readonly lastTriggerSource: SyncRuntimeTriggerSource | null;
  readonly lastSyncedCount: number;
}

export interface SyncRuntimeStatusPatch {
  readonly registrationStatus?: SyncRuntimeRegistrationStatus;
  readonly lastAttemptAt?: number | null;
  readonly lastSuccessAt?: number | null;
  readonly lastFailureMessage?: string | null;
  readonly lastTriggerSource?: SyncRuntimeTriggerSource | null;
  readonly lastSyncedCount?: number;
}
