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

/**
 * The counters the status row ALWAYS stores as a plain number. Neither of them has a "never
 * measured" state, so a reader never has to tell a measured zero apart from a read that never
 * happened.
 *
 * The counter keys are declared ONCE for the whole file: as this union and `SyncNullableCountKey`,
 * which reach both views through `Readonly<Record<...>>` (the snapshot, where every counter is
 * required) and `Partial<Readonly<Record<...>>>` (the patch, where every counter may be omitted).
 * One list is what keeps the required and the optional view of a counter from drifting apart, and
 * it is why a counter that may legitimately be absent belongs in `SyncNullableCountKey` and never
 * here: widening THIS union would let a row that was never measured report a zero nobody counted.
 *
 * `consecutiveUnclosedCycles` is the bookkeeping streak -- consecutive cycles that never released
 * the active flag, which separates a one-off from a quota bleed. `lastFailedCheckpointCount`
 * counts the checkpoints that failed to persist; non-zero marks the `lastCycleStage` beside it as
 * degraded, not wrong.
 */
type SyncCountKey = 'consecutiveUnclosedCycles' | 'lastFailedCheckpointCount';

/**
 * The counters whose value is `number | null`, where `null` means THE READ NEVER HAPPENED -- never
 * a plausible zero, which would misreport "no lost edits" (design.md
 * `2026-09-09-convergence-instrumentation` Decision 7). Every one of them stays `null` until the
 * first cycle folds it into the bookkeeping write, and for any cycle that never reaches it
 * (Decision 6). Same single-list rule, and the same two views, as `SyncCountKey` above.
 *
 * Each key, and the fact it answers:
 * - `lastCycleStageAt`: instant of the last checkpoint, so a killed cycle's duration is measured
 *   rather than inferred.
 * - `lastDiagnosticsDiscardedCount`: envelopes the bridge permanently rejected as malformed and
 *   this device destroyed. It is the BRIDGE's verdict.
 * - `lastDiagnosticsUndeliverableCount`: a destruction this device ORDERED by DECLARING a
 *   `SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS` kind unpostable (migration `0014`), never a bridge
 *   verdict, and not the same fact as `discarded`: a destruction must never be invisible while the
 *   registry authorizing it is being changed.
 * - `lastDiagnosticsUnclassifiedCount`: a PARK -- this build does not know the `kind`, so the
 *   envelope is never posted and never deleted, and a roll-forward recovers it. A third fact, and
 *   for the same reason as the previous one: another build of this app owns that kind.
 * - `lastDiagnosticsReapedCount`: RETIRED by `SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS` (migration
 *   `0015`) -- a park that outlived the declared wait. A fourth fact, and it must never be folded
 *   into `discarded`: that counter says the bridge refused these bytes, while this one says the
 *   drain gave up waiting for a bridge that would have accepted them.
 * - `lastDiagnosticsFailedRemovalCount`: envelopes that got a 2xx but whose outbox removal failed;
 *   they re-send next cycle.
 * - `lastOutboxFailedWriteCount`: cumulative outbox writes that could not be persisted, as of this
 *   cycle's bookkeeping write. Written by the same folded bookkeeping write as the keys above.
 * - `lastDeadLetterCount` / `lastConflictExhaustedCount`: `operation_log` rows in that status,
 *   counted before retention deletes them.
 * - `lastStuckProcessingCount`: rows still `processing` when the projection ran -- orphaned, not in
 *   flight.
 * - `lastOldestPendingAgeMs`: age of the oldest `pending`-or-`processing` row; `null` also when the
 *   queue was empty.
 * - `lastPendingRowCount`: TRUE backlog row depth, never the bounded per-cycle batch size; the
 *   `hasMore` flag is derived from it.
 */
type SyncNullableCountKey =
  | 'lastCycleStageAt'
  | 'lastDiagnosticsDiscardedCount'
  | 'lastDiagnosticsUndeliverableCount'
  | 'lastDiagnosticsUnclassifiedCount'
  | 'lastDiagnosticsReapedCount'
  | 'lastDiagnosticsFailedRemovalCount'
  | 'lastOutboxFailedWriteCount'
  | 'lastDeadLetterCount'
  | 'lastConflictExhaustedCount'
  | 'lastStuckProcessingCount'
  | 'lastOldestPendingAgeMs'
  | 'lastPendingRowCount';

/**
 * Defines the data contract for sync runtime status snapshot.
 *
 * Every counter is required here, and each one is declared exactly once, as a member of the key
 * unions above: the `Record` views are what stop the snapshot and the patch from each restating
 * the counter list (a restatement the semantic duplicate-block audit reports as a clone, and one
 * that silently lets the two views disagree).
 */
export interface SyncRuntimeStatusSnapshot
  extends Readonly<Record<SyncCountKey, number>>,
    Readonly<Record<SyncNullableCountKey, number | null>> {
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
}

/**
 * Defines the data contract for sync runtime status patch.
 *
 * The same counter keys as the snapshot, seen through `Partial`: a counter may be omitted
 * (`undefined` means "this patch does not mention it") or cleared with an explicit `null`. Deriving
 * the optional view from the required one is what keeps the two from disagreeing -- a counter is
 * added, removed, or retyped in ONE place, the key unions above.
 */
export interface SyncRuntimeStatusPatch
  extends Partial<Readonly<Record<SyncCountKey, number>>>,
    Partial<Readonly<Record<SyncNullableCountKey, number | null>>> {
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
