import type { SyncSQLiteRuntime } from './sqlite-sync-runtime.types';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';

/**
 * Names the furthest leg of the cycle that was entered before the budget expired.
 *
 * This is the only thing a caller learns about a cycle that never came back, so the stages are cut
 * where the diagnosis differs: `reconcile` covers the bridge round trip and the write that applies
 * its answer -- the leg the device measured hanging -- while `attempt_started` and `cycle_activated`
 * separate a door that was already jammed on arrival from one that jammed mid-cycle.
 */
export type HeadlessSyncCycleStage =
  | 'open'
  | 'bridge_config'
  | 'attempt_started'
  | 'cycle_activated'
  | 'reconcile'
  | 'result_bookkeeping'
  | 'prune';

/**
 * Carries the cycle's progress out of a body that can no longer return anything.
 *
 * Mutable on purpose: the enclosing deadline exists precisely for the case where the cycle never
 * returns, so its progress has to be readable from outside rather than handed back on the way out.
 */
export interface HeadlessSyncCycleProgress {
  stage: HeadlessSyncCycleStage;
  attemptedAt: number;
}

/** Defines the data contract for run headless sync cycle params. */
export interface RunHeadlessSyncCycleParams {
  readonly runtime: SyncSQLiteRuntime;
  readonly triggerSource: SyncRuntimeTriggerSource;
  /** Overrides the cycle budget. Omitted means `HEADLESS_SYNC_CYCLE_DEADLINE_MS`. */
  readonly deadlineMs?: number;
  /** Overrides the recovery budget. Omitted means `HEADLESS_SYNC_CYCLE_RECOVERY_DEADLINE_MS`. */
  readonly recoveryDeadlineMs?: number;
}

/** Defines the data contract for headless sync cycle result. */
export interface HeadlessSyncCycleResult {
  readonly kind: 'success' | 'failed' | 'no_op';
  readonly syncedCount: number;
}
