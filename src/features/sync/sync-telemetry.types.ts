import type {
  SyncDiagnosticEvent,
  WireSyncDiagnosticEvent,
} from './sync-diagnostic-events.types';
import type {
  SYNC_CYCLE_ERROR_CAUSES,
  SYNC_CYCLE_ERROR_NAMES,
  SYNC_CYCLE_ERROR_STAGES,
} from './sync-telemetry.constants';
import type {
  SyncCycleStage,
  SyncRuntimeStatusSnapshot,
  SyncRuntimeTriggerSource,
} from './sync-runtime-status.types';

/**
 * How a sync cycle ended.
 *
 * `never_closed` is the one a dead process cannot report about itself: it is inferred by the
 * following cycle from a `isCycleActive` flag that was never released, which only happens when
 * the `finally` block never ran.
 */
export type SyncCycleOutcome = 'completed' | 'failed' | 'never_closed';

/** Whether the app process was foregrounded when the cycle ran. */
export type SyncCycleAppState = 'foreground' | 'background';

/** Error class, restricted to the allowlist so no free text can reach an unsanitized store. */
export type SyncCycleErrorName = (typeof SYNC_CYCLE_ERROR_NAMES)[number];

/** Transaction phase an error is attributed to, restricted for the same reason. */
export type SyncCycleErrorStage = (typeof SYNC_CYCLE_ERROR_STAGES)[number];

/** Canonical reason a cycle failed, derived on-client from the message so the message stays home. */
export type SyncCycleErrorCause = (typeof SYNC_CYCLE_ERROR_CAUSES)[number];

/** The previous cycle's post-mortem, reconstructed from what it managed to persist. */
export interface PreviousCycleTelemetry {
  readonly cycleId: string | null;
  readonly triggerSource: SyncRuntimeTriggerSource | null;
  readonly outcome: SyncCycleOutcome;
  readonly lastStage: SyncCycleStage | null;
  readonly startedAt: number | null;
  readonly elapsedMs: number | null;
  readonly errorName: SyncCycleErrorName | null;
  readonly nativeErrcodeByte: number | null;
  readonly errorStage: SyncCycleErrorStage | null;
  /** Why it failed, not merely what threw. Separates a closed handle from lock contention. */
  readonly errorCause: SyncCycleErrorCause | null;
  /** 8-hex grouping key for an error class with no symbol yet. Never derived from a message. */
  readonly errorFingerprint: string | null;
}

/** Counters that separate an isolated failure from an ongoing incident. */
export interface SyncCycleCounters {
  readonly consecutiveUnclosedCycles: number;
  readonly pendingOpsCount: number;
  readonly cursor: number;
}

/** One cycle's telemetry envelope, carrying the PREVIOUS cycle's outcome alongside its own identity. */
export interface SyncCycleTelemetry {
  readonly cycleId: string;
  readonly triggerSource: SyncRuntimeTriggerSource;
  readonly appState: SyncCycleAppState;
  readonly previousCycle: PreviousCycleTelemetry | null;
  readonly counters: SyncCycleCounters;
  /**
   * Recent app-wide trouble, coalesced. The cycle post-mortem only sees the cycle; these carry
   * the WebSocket, mutation, resync and host-registration signals that live outside it and
   * would otherwise still need a USB cable.
   */
  readonly recentEvents: readonly SyncDiagnosticEvent[];
}

/** Inputs `buildSyncCycleTelemetry` needs; `now` omitted means elapsed time is unknowable. */
export interface BuildSyncCycleTelemetryInput {
  readonly cycleId: string;
  readonly triggerSource: SyncRuntimeTriggerSource;
  readonly appState: SyncCycleAppState;
  readonly snapshot: SyncRuntimeStatusSnapshot;
  readonly pendingOpsCount: number;
  readonly cursor: number;
  readonly now?: number;
  readonly recentEvents?: readonly SyncDiagnosticEvent[];
}

/** The exact snake_case shape sent to the bridge. Nothing outside this contract crosses the wire. */
export interface WireSyncCycleTelemetry {
  readonly cycle_id: string;
  readonly trigger_source: SyncRuntimeTriggerSource;
  readonly app_state: SyncCycleAppState;
  readonly previous_cycle: {
    readonly cycle_id: string | null;
    readonly trigger_source: SyncRuntimeTriggerSource | null;
    readonly outcome: SyncCycleOutcome;
    readonly last_stage: SyncCycleStage | null;
    readonly started_at: number | null;
    readonly elapsed_ms: number | null;
    readonly error_name: SyncCycleErrorName | null;
    readonly native_errcode_byte: number | null;
    readonly error_stage: SyncCycleErrorStage | null;
    readonly error_cause: SyncCycleErrorCause | null;
    readonly error_fingerprint: string | null;
  } | null;
  readonly counters: {
    readonly consecutive_unclosed_cycles: number;
    readonly pending_ops_count: number;
    readonly cursor: number;
  };
  readonly recent_events: readonly WireSyncDiagnosticEvent[];
}
