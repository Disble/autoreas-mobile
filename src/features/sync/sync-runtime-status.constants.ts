import type { SyncRuntimeStatusSnapshot } from './sync-runtime-status.types';

/** Provides the shared sync runtime status singleton id value. */

export const SYNC_RUNTIME_STATUS_SINGLETON_ID = 1;

/**
 * The checkpoints the JS foreground cycle records, in execution order: `attempt_started` when the
 * cycle begins (`recordSyncAttemptStarted`) and `closed` when it succeeds
 * (`recordSyncAttemptSucceeded`). A failure clears the stage. This array is the single source of
 * `SyncCycleStage`.
 */
export const SYNC_CYCLE_STAGES = ['attempt_started', 'closed'] as const;

/** Provides the shared default sync runtime status snapshot value. */

export const DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT: SyncRuntimeStatusSnapshot = {
  registrationStatus: 'unregistered',
  executionMode: 'best_effort_background_task',
  canShowPersistentNotification: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastCycleId: null,
  lastCycleStage: null,
  lastErrorName: null,
};

/** Provides the shared unsupported sync runtime status snapshot value. */

export const UNSUPPORTED_SYNC_RUNTIME_STATUS_SNAPSHOT: SyncRuntimeStatusSnapshot = {
  ...DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  registrationStatus: 'unsupported',
};
