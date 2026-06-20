import type { SyncRuntimeStatusSnapshot } from './sync-runtime-status.types';

export const SYNC_RUNTIME_STATUS_SINGLETON_ID = 1;

export const DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT: SyncRuntimeStatusSnapshot = {
  registrationStatus: 'unregistered',
  executionMode: 'best_effort_background_task',
  isForegroundServiceRunning: false,
  canShowPersistentNotification: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureMessage: null,
  lastTriggerSource: null,
  lastSyncedCount: 0,
  isCycleActive: false,
  lastBacklogReadCount: 0,
  lastPrunedOperationsCount: 0,
};

export const UNSUPPORTED_SYNC_RUNTIME_STATUS_SNAPSHOT: SyncRuntimeStatusSnapshot = {
  registrationStatus: 'unsupported',
  executionMode: 'best_effort_background_task',
  isForegroundServiceRunning: false,
  canShowPersistentNotification: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureMessage: null,
  lastTriggerSource: null,
  lastSyncedCount: 0,
  isCycleActive: false,
  lastBacklogReadCount: 0,
  lastPrunedOperationsCount: 0,
};
