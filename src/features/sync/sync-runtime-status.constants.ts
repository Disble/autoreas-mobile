import type { SyncRuntimeStatusSnapshot } from './sync-runtime-status.types';

/** Provides the shared sync runtime status singleton id value. */

export const SYNC_RUNTIME_STATUS_SINGLETON_ID = 1;

/**
 * The checkpoints one sync cycle passes through, in execution order.
 *
 * THIS ARRAY IS THE SINGLE SOURCE. `SyncCycleStage` is derived from it and the telemetry
 * allowlist re-exports it, so the vocabulary cannot drift between the state machine, the
 * persisted column, and the wire without the typecheck saying so.
 *
 * Each member mirrors one step of the real cycle, read off `runHeadlessSyncCycle` and
 * `performSyncPendingOperations` rather than invented:
 * - `open`            -> `runtime.open()`
 * - `config`          -> `getBridgeConfigSnapshot` (a READ)
 * - `attempt_started` -> `recordSyncAttemptStarted`, an awaited write through the shared door
 * - `cycle_activated` -> `recordCycleActive(true)`, likewise
 * - `backlog_read`    -> `readOperationLogBacklog`
 * - `claim_ops`       -> the `withLocalWrite` that marks the batch `processing`
 * - `http`            -> `bridgeClient.reconcile`
 * - `parse_response`  -> `ReconcileResponseSchema.safeParse`
 * - `apply_write`     -> the post-HTTP `withLocalWrite` (stage/confirm/cursor, all one txn)
 * - `prune`           -> `pruneOperationLog`
 * - `closed`          -> the `finally` released the cycle
 *
 * The two write steps after `config` are listed separately for a specific reason: when the shared
 * write door is already jammed from an earlier cycle, the cycle dies on one of THEM. Folding them
 * into `config` would blame a read that completed and send the reader to innocent code -- and a
 * jammed door is the leading suspect, so this is exactly the distinction worth keeping.
 *
 * `parse_response` is the one member that is NOT an awaited step: `safeParse` is synchronous and
 * cannot hang. It earns its place only by separating "the HTTP call returned" from "the post-HTTP
 * write began", which are otherwise indistinguishable in a `never_closed` report.
 *
 * A stage missing here does not degrade the signal, it erases it: a cycle killed at an unnamed
 * step reports the PREVIOUS step. For a `never_closed` outcome no JS error handler ever ran, so
 * this field plus `elapsed_ms` carry the whole diagnosis -- the error triple is empty by
 * construction.
 */
export const SYNC_CYCLE_STAGES = [
  'open',
  'config',
  'attempt_started',
  'cycle_activated',
  'backlog_read',
  'claim_ops',
  'http',
  'parse_response',
  'apply_write',
  'prune',
  'closed',
] as const;

/** Provides the shared default sync runtime status snapshot value. */

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
  isBackgroundTaskRegistered: false,
  lastCycleId: null,
  lastCycleStage: null,
  lastErrorName: null,
  lastNativeErrcodeByte: null,
  lastErrorStage: null,
  consecutiveUnclosedCycles: 0,
  lastCycleStageAt: null,
  lastFailedCheckpointCount: 0,
  lastDiagnosticsDiscardedCount: null,
  lastDiagnosticsFailedRemovalCount: null,
  lastOutboxFailedWriteCount: null,
  lastDeadLetterCount: null,
  lastConflictExhaustedCount: null,
  lastStuckProcessingCount: null,
  lastOldestPendingAgeMs: null,
  lastPendingRowCount: null,
};

/** Provides the shared unsupported sync runtime status snapshot value. */

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
  isBackgroundTaskRegistered: false,
  lastCycleId: null,
  lastCycleStage: null,
  lastErrorName: null,
  lastNativeErrcodeByte: null,
  lastErrorStage: null,
  consecutiveUnclosedCycles: 0,
  lastCycleStageAt: null,
  lastFailedCheckpointCount: 0,
  lastDiagnosticsDiscardedCount: null,
  lastDiagnosticsFailedRemovalCount: null,
  lastOutboxFailedWriteCount: null,
  lastDeadLetterCount: null,
  lastConflictExhaustedCount: null,
  lastStuckProcessingCount: null,
  lastOldestPendingAgeMs: null,
  lastPendingRowCount: null,
};
