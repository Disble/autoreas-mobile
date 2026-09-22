import type { SyncExecutionMode } from './sync-execution-mode.types';
import type { SyncRuntimeRegistrationStatus } from './sync-runtime-status.types';

/** Defines the data contract for sync execution status. */
export interface SyncExecutionStatus {
  readonly registrationStatus: SyncRuntimeRegistrationStatus;
  readonly executionMode: SyncExecutionMode;
  readonly isForegroundServiceRunning: boolean;
  readonly canShowPersistentNotification: boolean;
  readonly isBackgroundTaskRegistered: boolean;
  /**
   * Whether the app is currently exempt from Android's battery-optimization restrictions
   * (`PowerManager.isIgnoringBatteryOptimizations`). This is an OS-level fact with no cycle of
   * its own -- unlike every other field here it is not tied to a register/unregister lifecycle,
   * so builders read it live rather than tracking it as strategy state.
   */
  readonly isBatteryOptimizationExempt: boolean;
}

/** Defines the data contract for sync execution strategy. */
export interface SyncExecutionStrategy {
  readonly mode: SyncExecutionMode;
  readonly register: () => Promise<void>;
  readonly unregister: () => Promise<void>;
  readonly getStatus: () => Promise<SyncExecutionStatus>;
}
