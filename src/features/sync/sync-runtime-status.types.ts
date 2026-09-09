import type { SYNC_CYCLE_STAGES } from './sync-runtime-status.constants';
import type { SyncExecutionMode } from './sync-execution-mode.types';
import type { SyncCycleErrorName, SyncCycleErrorStage } from './sync-telemetry.types';

/** Defines the sync runtime registration status value shape. */
export type SyncRuntimeRegistrationStatus = 'registered' | 'unregistered' | 'unsupported';

/** Defines the sync runtime trigger source value shape. */
export type SyncRuntimeTriggerSource =
  | 'bootstrap'
  | 'manual'
  | 'app_active'
  | 'network_regained'
  | 'local_mutation'
  // Distinct from 'local_mutation': that one reports a *sync* failure after a mutation landed
  // locally, while this reports the local SQLite write itself never landing. Diagnosing a dead
  // +/- button depends entirely on telling those two apart.
  | 'local_mutation_write'
  | 'ws_sync_required'
  | 'foreground_service'
  | 'background_task';

/**
 * One checkpoint of the sync cycle, derived from `SYNC_CYCLE_STAGES` so the vocabulary cannot
 * drift between the state machine, the persisted column, and the wire without the typecheck
 * saying so. The array lives in `sync-runtime-status.constants.ts` and carries the mapping from
 * each member to the awaited step it names.
 */
export type SyncCycleStage = (typeof SYNC_CYCLE_STAGES)[number];

/** Defines the data contract for sync runtime status snapshot. */
export interface SyncRuntimeStatusSnapshot {
  readonly registrationStatus: SyncRuntimeRegistrationStatus;
  readonly executionMode: SyncExecutionMode;
  readonly isForegroundServiceRunning: boolean;
  readonly canShowPersistentNotification: boolean;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureMessage: string | null;
  readonly lastTriggerSource: SyncRuntimeTriggerSource | null;
  readonly lastSyncedCount: number;
  readonly isCycleActive: boolean;
  readonly lastBacklogReadCount: number;
  readonly lastPrunedOperationsCount: number;
  readonly isBackgroundTaskRegistered: boolean;
  /** Correlates this device's cycle with the request the bridge captured for it. */
  readonly lastCycleId: string | null;
  /** How far the previous cycle got. The only trace a host-killed cycle leaves about its location. */
  readonly lastCycleStage: SyncCycleStage | null;
  /** Error class of the previous cycle, kept structured so `LocalWriteError` is machine-separable. */
  readonly lastErrorName: string | null;
  /**
   * Code point of the control byte `parseSqliteErrcode` found in the native message -- NOT a
   * SQLite result code, despite how close the numbers look. Null when nothing parseable was there.
   */
  readonly lastNativeErrcodeByte: number | null;
  /** Transaction phase the error surfaced in, e.g. `begin`. */
  readonly lastErrorStage: string | null;
  /** Consecutive cycles that never released the active flag. Separates a one-off from a quota bleed. */
  readonly consecutiveUnclosedCycles: number;
  /** Instant of the last checkpoint, so a killed cycle's duration is measured, not inferred. */
  readonly lastCycleStageAt: number | null;
  /** Checkpoints that failed to persist. Non-zero marks `lastCycleStage` as degraded, not wrong. */
  readonly lastFailedCheckpointCount: number;
}

/** Defines the data contract for sync runtime status patch. */
export interface SyncRuntimeStatusPatch {
  readonly registrationStatus?: SyncRuntimeRegistrationStatus;
  readonly executionMode?: SyncExecutionMode;
  readonly isForegroundServiceRunning?: boolean;
  readonly canShowPersistentNotification?: boolean;
  readonly lastAttemptAt?: number | null;
  readonly lastSuccessAt?: number | null;
  readonly lastFailureMessage?: string | null;
  readonly lastTriggerSource?: SyncRuntimeTriggerSource | null;
  readonly lastSyncedCount?: number;
  readonly isCycleActive?: boolean;
  readonly lastBacklogReadCount?: number;
  readonly lastPrunedOperationsCount?: number;
  readonly isBackgroundTaskRegistered?: boolean;
  readonly lastCycleId?: string | null;
  readonly lastCycleStage?: SyncCycleStage | null;
  // Narrowed to the closed vocabulary (D4): a caller cannot construct an out-of-vocabulary
  // value here, so drift fails `tsc` at the write site instead of surfacing only as a bridge
  // `400`. `SyncRuntimeStatusSnapshot` keeps `string | null` -- the column is free-form TEXT
  // and legacy rows predate this union.
  readonly lastErrorName?: SyncCycleErrorName | null;
  readonly lastNativeErrcodeByte?: number | null;
  readonly lastErrorStage?: SyncCycleErrorStage | null;
  readonly consecutiveUnclosedCycles?: number;
  readonly lastCycleStageAt?: number | null;
  readonly lastFailedCheckpointCount?: number;
}

/**
 * Extra facts a failure patch may carry beyond the failure message, so `previous_cycle.*`
 * can report where and why the cycle failed instead of only that it failed. Every field is
 * optional and defaults to `null`: a caller outside the headless cycle's stage machine (a
 * foreground sync, a mutation write) has none of this to report, and `null` says so honestly
 * instead of fabricating a stage or error class the failure never actually passed through.
 */
export interface SyncAttemptFailureDetail {
  /** Correlates this failure with the request the bridge captured for it, when known. */
  readonly cycleId?: string | null;
  /** How far the cycle got before it failed. */
  readonly stage?: SyncCycleStage | null;
  /** Error class the cycle failed with, restricted to the closed vocabulary. */
  readonly errorName?: SyncCycleErrorName | null;
  /** Transaction phase the error surfaced in, restricted to the closed vocabulary. */
  readonly errorStage?: SyncCycleErrorStage | null;
  /** Code point of the native control byte, when one was parseable. */
  readonly nativeErrcodeByte?: number | null;
}
