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
 * Maps the flush counters that answer "was anything destroyed, parked or retired?" onto their patch
 * columns, or an empty patch when the caller holds no flush evidence at all.
 *
 * Extracted so the two writes that can carry them map them through ONE function: the headless
 * cycle's `recordBacklogReadCount` and the foreground cycle's terminal `recordSyncAttemptSucceeded`.
 * They are NOT derived from one another and never fold into one another. `discarded` counts what
 * the BRIDGE condemned (400/413 -- a permanent rejection by its own verdict) and keeps exactly
 * that meaning in both writes; `undeliverable` counts what THIS build ordered destroyed because the
 * row's `kind` can never be accepted; `unclassified` counts what was PARKED because it belongs to a
 * different build, where rolling forward is what recovers it -- a gap counter, not a loss counter;
 * and `reaped` counts what the AGE BOUND retired, which is neither a verdict nor a declaration but
 * the one place this pipeline gave up waiting. That last one is why all four keep their own column:
 * a non-zero `discarded` has to go on separating "the bridge refused these bytes" from "we gave up
 * waiting for a bridge that would have accepted them".
 *
 * Absent evidence yields NO fields rather than zeros: an unmeasured cycle must leave the
 * columns exactly as they were, because a destruction counter reading 0 because it was never
 * written is the precise false answer the `?? null` rule forbids (design.md Decision 7).
 */
function buildDiagnosticsCounterPatchFields(
  diagnosticsFlush: SyncDiagnosticsFlushResult | undefined,
): SyncRuntimeStatusPatch {
  if (!diagnosticsFlush) {
    return {};
  }

  return {
    lastDiagnosticsDiscardedCount: diagnosticsFlush.discarded,
    lastDiagnosticsUndeliverableCount: diagnosticsFlush.undeliverable,
    lastDiagnosticsUnclassifiedCount: diagnosticsFlush.unclassified,
    lastDiagnosticsReapedCount: diagnosticsFlush.reaped,
  };
}

/**
 * Builds the snapshot patch for a successful sync cycle.
 *
 * Success records both the latest attempt timestamp and how many operations were confirmed, and
 * now also marks the stage `closed`, CLEARS the error triple to explicit `null` (Requirement:
 * "A succeeded cycle clears the previous error detail"), and resets `consecutiveUnclosedCycles`
 * -- a success closes the cycle it belongs to. Closing the cycle also RELEASES the
 * `isCycleActive` flag: this patch is the last status write of the cycle's success path, so
 * recording the outcome without releasing the flag would leave every later attempt counted as
 * unclosed. The explicit `recordCycleActive(false)` in the cycle's `finally` stays -- it is
 * idempotent -- but it is no longer the only thing standing between a reported outcome and a
 * flag stuck on.
 *
 * `diagnosticsFlush` is optional and, when supplied, folds this cycle's three destruction
 * counters into the SAME write -- the foreground coordinated cycle has no bookkeeping write of its
 * own, so folding is what keeps its counters from costing a second transaction (see
 * `runCoordinatedForegroundSyncCycle`). Callers without flush evidence (the headless cycle, which
 * writes its own bookkeeping through `recordBacklogReadCount`, and every pre-existing caller) leave
 * the three columns untouched instead of fabricating three zeros.
 */
export function buildSyncAttemptSucceededPatch(
  triggerSource: SyncRuntimeTriggerSource,
  attemptedAt: number,
  syncedCount: number,
  cycleId: string | null = null,
  diagnosticsFlush?: SyncDiagnosticsFlushResult,
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
    isCycleActive: false,
    ...buildDiagnosticsCounterPatchFields(diagnosticsFlush),
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
 * `consecutiveUnclosedCycles` resets to zero, and the terminal write RELEASES the
 * `isCycleActive` flag: this patch is the last status write of the cycle's failure path, and a
 * cycle that reports its outcome must never leave the flag set -- otherwise the counter measures
 * past leaks on every later attempt instead of the present one.
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
    isCycleActive: false,
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
 * Folds one cycle's bounded backlog read size, its diagnostics-outbox flush and write-failure
 * counters, and its operation-log convergence projection into a single patch (design.md
 * `2026-09-09-convergence-instrumentation` Decision 6). This is the SAME write
 * `recordBacklogReadCount` already performed before this change -- widened, not duplicated --
 * so the shared write door gains zero new transactions.
 *
 * Every counter here comes from a value its caller already computed this cycle (the flush
 * result, the outbox store's own failure count, the convergence projection), so none of them is
 * ever fabricated: an unmeasured cycle simply never calls this, and the columns stay `null`
 * (Decision 7) rather than reporting a plausible zero. The three destruction counters themselves
 * are mapped by `buildDiagnosticsCounterPatchFields`, shared with the foreground cycle's terminal
 * `recordSyncAttemptSucceeded` so the two writes that carry them cannot drift apart.
 */
export function buildCycleBookkeepingPatch(
  backlogReadCount: number,
  diagnosticsFlush: SyncDiagnosticsFlushResult,
  outboxFailedWriteCount: number,
  convergence: OperationLogConvergence,
): SyncRuntimeStatusPatch {
  return {
    lastBacklogReadCount: backlogReadCount,
    ...buildDiagnosticsCounterPatchFields(diagnosticsFlush),
    lastDiagnosticsFailedRemovalCount: diagnosticsFlush.failedRemovals,
    lastOutboxFailedWriteCount: outboxFailedWriteCount,
    lastDeadLetterCount: convergence.deadLetterCount,
    lastConflictExhaustedCount: convergence.conflictExhaustedCount,
    lastStuckProcessingCount: convergence.stuckProcessingCount,
    lastOldestPendingAgeMs: convergence.oldestPendingAgeMs,
    lastPendingRowCount: convergence.pendingRowCount,
  };
}
