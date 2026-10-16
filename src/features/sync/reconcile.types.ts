import type { BridgeConnection } from '../../infrastructure/api';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import type { OutboxClaim } from './outbox-claim.types';
import type { SyncDiagnosticEvent } from './sync-diagnostic-events.types';
import type { SyncDiagnosticsFlushResult } from './sync-diagnostics-flush.types';
import type {
  SyncCycleStage,
  SyncRuntimeStatusSnapshot,
  SyncRuntimeTriggerSource,
} from './sync-runtime-status.types';
import type { SyncCycleAppState, WireSyncCycleTelemetry } from './sync-telemetry.types';
import type { ConfirmedAnimeToken } from './applied-operation-token.helpers';
import type { ConflictOutcome } from './reconcile-conflict.helpers';
import type { RemoteAnimeChange } from './merge/merge.types';

/**
 * Selects where a reconcile pass writes its pulled `bridge_changes`:
 * - `deferred` -> applies directly to `animes` via the merge boundary inside
 *   `withLocalWrite` on the shared reactive connection (foreground callers: the manual
 *   reconcile mutation, bootstrap reconcile, WS-triggered sync).
 * - `staged` -> never touches `animes`; inserts into `pending_remote_changes` instead, for
 *   callers running on the isolated, non-reactive background connection (the headless sync
 *   cycle). A foreground drain hook later applies staged rows via the same merge boundary.
 */
export type ReconcileApplyMode = 'deferred' | 'staged';

/**
 * Publishes one checkpoint of the reconcile pass to the sync-cycle instrument.
 *
 * The contract is ENTRY semantics: the recorder is called before awaiting the step it names, so
 * a hang inside a step reports THAT step rather than the last one that finished. Synchronous and
 * never throwing by contract -- the instrument must never be the reason a pass fails. Optional:
 * foreground callers run without it and only the headless cycle supplies the store.
 */
export type SyncCycleCheckpointRecorder = (stage: SyncCycleStage) => void;

/**
 * What only the CALLER can supply about the cycle it is running.
 *
 * The snapshot in particular has to be captured by the caller, before it records the attempt
 * start: `recordSyncAttemptStarted` and `recordCycleActive(true)` overwrite the exact fields the
 * post-mortem reads, so a snapshot taken any later would describe THIS cycle and report every
 * previous one as `never_closed`. Reconcile fills in what only IT knows -- pending count and
 * cursor -- and the two halves meet at `resolveClientTelemetry`.
 */
export interface ReconcileTelemetryContext {
  readonly cycleId: string;
  readonly triggerSource: SyncRuntimeTriggerSource;
  readonly appState: SyncCycleAppState;
  readonly snapshot: SyncRuntimeStatusSnapshot;
  readonly recentEvents: readonly SyncDiagnosticEvent[];
}

/** Input to `applyReconcileResponseWrites`, one field per write source this cycle produced. */
export interface ApplyReconcileResponseWritesParams {
  readonly applyMode: ReconcileApplyMode;
  readonly normalizedChanges: readonly RemoteAnimeChange[];
  readonly confirmedAnimeTokens: readonly ConfirmedAnimeToken[];
  readonly conflictOutcomes: readonly ConflictOutcome[];
  readonly deadLetterIds: readonly number[];
  readonly confirmedIds: readonly number[];
  readonly remainingUnconfirmedIds: readonly number[];
  readonly lastChangelogId: number;
  readonly nextLastChangelogId: number;
  readonly bridgeConfigId: number;
  /** The claim this cycle holds; every status write is compare-and-set on it (ADR 009 R-13). */
  readonly claim: OutboxClaim;
}

/**
 * Describes the result of one bounded reconcile pass.
 * Callers use this to update observability and decide whether another batch is likely waiting.
 */
export interface SyncPendingOperationsResult {
  readonly syncedCount: number;
  /**
   * Counts DISTINCT ANIMES batched, not rows queued -- the backlog read dedupes to one operation
   * per anime per cycle (design.md Decision 9). A queue with many duplicate ops for one anime
   * reports a smaller number here than the raw row count would.
   */
  readonly backlogReadCount: number;
  readonly hasMorePending: boolean;
  /** The diagnostics-outbox flush outcome for this cycle (design.md Decision 2/3). */
  readonly diagnosticsFlush: SyncDiagnosticsFlushResult;
}

/** What one reconcile round needs that stays fixed, or is carried forward, across a chain. */
export interface ReconcileRoundContext {
  readonly applyMode: ReconcileApplyMode;
  readonly connection: BridgeConnection;
  readonly deviceId: string | undefined;
  readonly bridgeConfigId: number;
  /** The cursor this round sends; each round carries the previous round's cursor forward. */
  readonly lastChangelogId: number;
  /** Piggybacked on the first round only, so one cycle reports its telemetry once. */
  readonly clientTelemetry: WireSyncCycleTelemetry | null;
  readonly claim: OutboxClaim;
  /** Epoch ms after which no further row is claimed for the chain (ADR 009 R-14). */
  readonly chainDeadline: number;
  readonly checkpointRecorder?: SyncCycleCheckpointRecorder;
}

/** What one reconcile round produced, and the rows the chain sends next. */
export interface ReconcileRoundOutcome {
  readonly sentCount: number;
  readonly confirmedCount: number;
  readonly unconfirmedCount: number;
  readonly nextLastChangelogId: number;
  /** The next row of every key this round confirmed, already claimed; empty ends the chain. */
  readonly successors: readonly OperationLogRow[];
}
