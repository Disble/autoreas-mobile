import type { SyncExecutionMode } from './sync-execution-mode.types';
import type { SyncRuntimeRegistrationStatus } from './sync-runtime-status.types';

export interface SyncExecutionStatus {
  readonly registrationStatus: SyncRuntimeRegistrationStatus;
  readonly executionMode: SyncExecutionMode;
  readonly isForegroundServiceRunning: boolean;
  readonly canShowPersistentNotification: boolean;
}

export interface SyncExecutionStrategy {
  readonly mode: SyncExecutionMode;
  readonly register: () => Promise<void>;
  readonly unregister: () => Promise<void>;
  readonly getStatus: () => Promise<SyncExecutionStatus>;
}
