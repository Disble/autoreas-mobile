import {
  DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
} from './sync-runtime-status.constants';
import type { SyncDiagnosticsFlushResult } from './sync-diagnostics-flush.types';
import type { OperationLogConvergence } from './operation-log-convergence.types';
import type {
  SyncAttemptFailureDetail,
  SyncRuntimeStatusPatch,
  SyncRuntimeStatusSnapshot,
  SyncRuntimeTriggerSource,
} from './sync-runtime-status.types';

/**
 * Pure `SyncRuntimeStatusPatch` builders, extracted from `sync-runtime-status.helpers.ts`
 * (CLAUDE.md #5, the 500-line rule) once the convergence-instrumentation counters pushed that
 * file over budget. This module owns ONLY construction -- no DB read, no DB write, no merge --
 * so every function here is directly unit-testable with plain inputs.
 */

/**
 * Creates the neutral runtime snapshot used before any observable sync activity exists.
 * Tests and UI both rely on this to avoid duplicating default-state assumptions.
 */
export function createEmptySyncRuntimeStatusSnapshot(): SyncRuntimeStatusSnapshot {
  return DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT;
}

/**
 * Builds the snapshot patch for the start of a sync attempt.
 *
 * Starting a cycle always clears the previous failure and records the current trigger source,
 * and now also records this cycle's identity, marks its stage `attempt_started`, and CLEARS the
 * error triple to explicit `null` -- without that clear a three-cycle-old error would keep being
 * reported as the previous cycle's. `consecutiveUnclosedCycles` is derived purely from
 * `previous`: it increments when the prior cycle never released `isCycleActive` (it started but
 * never closed) and resets to zero otherwise. `cycleId` defaults to `null` because a caller
 * outside the headless cycle's stage machine has no cycle identity to correlate.
 */
export function buildSyncAttemptStartedPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  previous: SyncRuntimeStatusSnapshot,
  cycleId: string | null = null,
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastFailureMessage: null,
    lastTriggerSource: triggerSource,
    lastCycleId: cycleId,
    lastCycleStage: 'attempt_started',
    lastCycleStageAt: attemptedAt,
    lastErrorName: null,
    lastErrorStage: null,
    lastNativeErrcodeByte: null,
    consecutiveUnclosedCycles: previous.isCycleActive
      ? previous.consecutiveUnclosedCycles + 1
      : 0,
  };
}

/**
 * Builds the snapshot patch for a successful sync cycle.
 *
 * Success records both the latest attempt timestamp and how many operations were confirmed, and
 * now also marks the stage `closed`, CLEARS the error triple to explicit `null` (Requirement:
 * "A succeeded cycle clears the previous error detail"), and resets `consecutiveUnclosedCycles`
 * -- a success closes the cycle it belongs to.
 */
export function buildSyncAttemptSucceededPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  syncedCount: number,
  cycleId: string | null = null,
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastSuccessAt: attemptedAt,
    lastFailureMessage: null,
    lastTriggerSource: triggerSource,
    lastSyncedCount: syncedCount,
    lastCycleId: cycleId,
    lastCycleStage: 'closed',
    lastCycleStageAt: attemptedAt,
    lastErrorName: null,
    lastErrorStage: null,
    lastNativeErrcodeByte: null,
    consecutiveUnclosedCycles: 0,
  };
}

/**
 * Builds the snapshot patch for a failed sync cycle.
 *
 * Failures keep the last success intact while exposing the current error to Settings, and now
 * also record the stage and classified error the cycle failed with (Requirement: "A failed
 * cycle records the stage and error it failed with"). Every `detail` field defaults to `null`:
 * a caller that cannot classify where or why the cycle failed reports that honestly rather than
 * fabricating a stage or error class. A failure also closes the cycle, so
 * `consecutiveUnclosedCycles` resets to zero.
 */
export function buildSyncAttemptFailedPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  message: string,
  detail: SyncAttemptFailureDetail = {},
): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastFailureMessage: message,
    lastTriggerSource: triggerSource,
    lastCycleId: detail.cycleId ?? null,
    lastCycleStage: detail.stage ?? null,
    lastCycleStageAt: attemptedAt,
    lastErrorName: detail.errorName ?? null,
    lastErrorStage: detail.errorStage ?? null,
    lastNativeErrcodeByte: detail.nativeErrcodeByte ?? null,
    consecutiveUnclosedCycles: 0,
  };
}

/**
 * Builds the snapshot patch that marks a sync cycle as active or inactive.
 * This lets Settings distinguish an idle runtime from one that is mid-cycle.
 */
export function buildCycleActivePatch(isActive: boolean): SyncRuntimeStatusPatch {
  return {
    isCycleActive: isActive,
  };
}

/**
 * Builds the snapshot patch for the latest operation-log prune result.
 * This exposes how much terminal history was reclaimed by TTL or max-count rules.
 */
export function buildPrunedOperationsCountPatch(count: number): SyncRuntimeStatusPatch {
  return {
    lastPrunedOperationsCount: count,
  };
}

/**
 * Folds one cycle's bounded backlog read size, its diagnostics-outbox flush and write-failure
 * counters, and its operation-log convergence projection into a single patch (design.md
 * `2026-09-09-convergence-instrumentation` Decision 6). This is the SAME write
 * `recordBacklogReadCount` already performed before this change -- widened, not duplicated --
 * so the shared write door gains zero new transactions.
 *
 * Every counter here comes from a value its caller already computed this cycle (the flush
 * result, the outbox store's own failure count, the convergence projection), so none of them is
 * ever fabricated: an unmeasured cycle simply never calls this, and the columns stay `null`
 * (Decision 7) rather than reporting a plausible zero.
 */
export function buildCycleBookkeepingPatch(
  backlogReadCount: number,
  diagnosticsFlush: SyncDiagnosticsFlushResult,
  outboxFailedWriteCount: number,
  convergence: OperationLogConvergence,
): SyncRuntimeStatusPatch {
  return {
    lastBacklogReadCount: backlogReadCount,
    lastDiagnosticsDiscardedCount: diagnosticsFlush.discarded,
    lastDiagnosticsFailedRemovalCount: diagnosticsFlush.failedRemovals,
    lastOutboxFailedWriteCount: outboxFailedWriteCount,
    lastDeadLetterCount: convergence.deadLetterCount,
    lastConflictExhaustedCount: convergence.conflictExhaustedCount,
    lastStuckProcessingCount: convergence.stuckProcessingCount,
    lastOldestPendingAgeMs: convergence.oldestPendingAgeMs,
    lastPendingRowCount: convergence.pendingRowCount,
  };
}
