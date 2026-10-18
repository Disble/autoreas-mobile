import type { BridgeConnection } from '../../infrastructure/api';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import type { OutboxClaim } from './outbox-claim.types';
import type { ConfirmedAnimeToken } from './applied-operation-token.helpers';
import type { ConflictOutcome } from './reconcile-conflict.helpers';
import type { RemoteAnimeChange } from './merge/merge.types';
import type { RequestIdSequence } from './request-id.types';

/** Input to `applyReconcileResponseWrites`, one field per write source this cycle produced. */
export interface ApplyReconcileResponseWritesParams {
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
  readonly hasMorePending: boolean;
  /**
   * A season rating was delivered, or refused with a 404 or 409, so the active-season snapshot
   * no longer matches what the bridge holds and should be fetched again (L28).
   */
  readonly shouldRefreshActiveSeason: boolean;
}

/**
 * What one round of a chain did across both endpoints (L28): its reconcile's outcome plus its
 * season ratings', and whether a rating answer calls for an active-season refresh.
 */
export interface SplitRoundOutcome extends ReconcileRoundOutcome {
  readonly shouldRefreshActiveSeason: boolean;
}

/** What one reconcile round needs that stays fixed, or is carried forward, across a chain. */
export interface ReconcileRoundContext {
  readonly connection: BridgeConnection;
  readonly deviceId: string | undefined;
  readonly bridgeConfigId: number;
  /** The cursor this round sends; each round carries the previous round's cursor forward. */
  readonly lastChangelogId: number;
  readonly claim: OutboxClaim;
  /** Epoch ms after which no further row is claimed for the chain (ADR 009 R-14). */
  readonly chainDeadline: number;
  /** The cycle's request numbering, shared by reference so every round keeps counting. */
  readonly requestIds: RequestIdSequence;
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
