import { DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT } from './sync-runtime-status.constants';
import type {
  SyncRuntimeStatusPatch,
  SyncRuntimeStatusSnapshot,
} from './sync-runtime-status.types';

/**
 * Pure `SyncRuntimeStatusPatch` builders. This module owns ONLY construction -- no DB read, no DB
 * write, no merge -- so every function here is directly unit-testable with plain inputs.
 *
 * The JS cycle has no cycle id or error class of its own to report, so every attempt patch clears
 * both: otherwise a native cycle's id or error would keep being reported as the last cycle's.
 */

/**
 * Creates the neutral runtime snapshot used before any observable sync activity exists.
 * Tests and UI both rely on this to avoid duplicating default-state assumptions.
 */
export function createEmptySyncRuntimeStatusSnapshot(): SyncRuntimeStatusSnapshot {
  return DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT;
}

/** Builds the snapshot patch for the start of a sync attempt: the stage is `attempt_started`. */
export function buildSyncAttemptStartedPatch(attemptedAt: number): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastCycleId: null,
    lastCycleStage: 'attempt_started',
    lastErrorName: null,
  };
}

/**
 * Builds the snapshot patch for a successful sync cycle: it records the success instant beside
 * the attempt and marks the stage `closed`.
 */
export function buildSyncAttemptSucceededPatch(attemptedAt: number): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastSuccessAt: attemptedAt,
    lastCycleId: null,
    lastCycleStage: 'closed',
    lastErrorName: null,
  };
}

/**
 * Builds the snapshot patch for a failed sync cycle. Failures keep the last success intact and
 * clear the stage: the JS cycle does not classify where it failed, so it reports no stage rather
 * than a fabricated one.
 */
export function buildSyncAttemptFailedPatch(attemptedAt: number): SyncRuntimeStatusPatch {
  return {
    lastAttemptAt: attemptedAt,
    lastCycleId: null,
    lastCycleStage: null,
    lastErrorName: null,
  };
}
