import type { SyncRuntimeStatusPatch } from './sync-runtime-status.types';
import type { SyncExecutionStatus } from './sync-execution-strategy.types';

/**
 * Maps an execution strategy status into the persisted runtime snapshot patch shape.
 * This keeps the runtime orchestration decoupled from any specific strategy implementation.
 */
export function buildSyncExecutionStatusPatch(
  status: SyncExecutionStatus,
): SyncRuntimeStatusPatch {
  return {
    registrationStatus: status.registrationStatus,
    executionMode: status.executionMode,
    isForegroundServiceRunning: status.isForegroundServiceRunning,
    canShowPersistentNotification: status.canShowPersistentNotification,
    isBackgroundTaskRegistered: status.isBackgroundTaskRegistered,
  };
}
