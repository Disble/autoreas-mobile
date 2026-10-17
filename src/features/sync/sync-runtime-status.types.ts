import type { SYNC_CYCLE_STAGES } from './sync-runtime-status.constants';
import type { SyncExecutionMode } from './sync-execution-mode.types';

/** Defines the sync runtime registration status value shape. */
export type SyncRuntimeRegistrationStatus = 'registered' | 'unregistered' | 'unsupported';

/** Defines the sync runtime trigger source value shape. */
export type SyncRuntimeTriggerSource =
  | 'bootstrap'
  | 'manual'
  | 'app_active'
  | 'network_regained'
  | 'local_mutation'
  | 'ws_sync_required';

/**
 * One checkpoint of the JS sync cycle, derived from `SYNC_CYCLE_STAGES` so the vocabulary cannot
 * drift between the state machine and the persisted column without the typecheck saying so.
 */
export type SyncCycleStage = (typeof SYNC_CYCLE_STAGES)[number];

/**
 * Defines the data contract for sync runtime status snapshot: the singleton row's columns that
 * something reads. Settings reads the registration, execution mode and notification facts; the
 * reachability evidence and the battery-exemption prompt read the attempt and success instants;
 * the device verification script reads the last cycle's id, stage and error class.
 */
export interface SyncRuntimeStatusSnapshot {
  readonly registrationStatus: SyncRuntimeRegistrationStatus;
  readonly executionMode: SyncExecutionMode;
  readonly canShowPersistentNotification: boolean;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  /** Correlates the last cycle with the journal entry the native engine wrote for it. */
  readonly lastCycleId: string | null;
  /**
   * How far the last cycle got. Free text on read: the native engine writes its own state names
   * (`sent`, `idle`, ...), while the JS cycle writes only a `SyncCycleStage`.
   */
  readonly lastCycleStage: string | null;
  /** Error class of the last cycle; the native engine writes it, the JS cycle clears it. */
  readonly lastErrorName: string | null;
}

/**
 * Defines the data contract for sync runtime status patch: the snapshot's fields, each optional.
 * `undefined` means "this patch does not mention it"; an explicit `null` clears the column.
 */
export interface SyncRuntimeStatusPatch {
  readonly registrationStatus?: SyncRuntimeRegistrationStatus;
  readonly executionMode?: SyncExecutionMode;
  readonly canShowPersistentNotification?: boolean;
  readonly lastAttemptAt?: number | null;
  readonly lastSuccessAt?: number | null;
  readonly lastCycleId?: string | null;
  readonly lastCycleStage?: SyncCycleStage | null;
  readonly lastErrorName?: string | null;
}
