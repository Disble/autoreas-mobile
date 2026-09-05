import type { OperationLogRow } from '../../infrastructure/db/schema';
import {
  CONFLICT_ATTEMPT_CAP,
  REASON_CONFLICT,
  REASON_UNSUPPORTED_OPERATION,
  STALLED_OPERATION_VISIBILITY_THRESHOLD_MS,
} from './reconcile-conflict.constants';
import { recordDiagnosticEvent } from './sync-diagnostic-store/sync-diagnostic-store.helpers';
import type { ReconcileAppliedOperation } from './reconcile.schema';

/**
 * The result of classifying one rejected (`applied: false`) `applied_operations` entry.
 * Every variant maps to exactly one wiring action in `reconcile.helpers.ts` -- see that file's
 * classification wiring for the operation_log/animes writes each kind triggers.
 */
export type RejectedOperationClassification =
  | { readonly kind: 'unsupported' }
  | {
      readonly kind: 'conflict_progress';
      readonly bridgeModifiedAt: number;
      readonly nextAttemptCount: number;
      readonly isStalled: boolean;
    }
  | {
      readonly kind: 'conflict_exhausted';
      readonly bridgeModifiedAt: number;
      readonly nextAttemptCount: number;
    }
  | { readonly kind: 'conflict_missing_token' }
  | { readonly kind: 'unrecognized_reason'; readonly reason: string | undefined };

/** Input to `classifyRejectedOperation`. */
export interface ClassifyRejectedOperationParams {
  /** The rejected (`applied: false`) entry from the bridge's `applied_operations[]`. */
  readonly appliedOperation: ReconcileAppliedOperation;
  /** This anime's `animes.bridge_modified_at` as read before this cycle's request was sent. */
  readonly storedBridgeModifiedAt: number | null;
  /** This operation's `operation_log.conflict_attempt_count` before this response. */
  readonly currentAttemptCount: number;
  /** This operation's `operation_log.created_at`, used only for the stall-visibility check. */
  readonly operationCreatedAt: number;
  /** The instant this response is being processed, injected for deterministic tests. */
  readonly now: number;
}

/**
 * Classifies one rejected `applied_operations` entry into exactly one outcome, per design.md
 * Decision 6 and the spec's conflict-handling requirements:
 *
 * - `unsupported_operation` -> terminal on the first response, no retry, counter never read.
 * - `conflict` with no `modified_at` -> a contract violation (the bridge always sends it on this
 *   branch), surfaced rather than defaulted to `0` -- a real, legitimate token that would silently
 *   overwrite an unknown value with a confident wrong one.
 * - `conflict` whose token differs from the stored one -> progress; the attempt counter RESETS
 *   to 0, never increments, because a new token is information the previous attempt lacked.
 * - `conflict` repeating the SAME token -> no progress; the attempt counter increments, and at
 *   `CONFLICT_ATTEMPT_CAP` the operation reaches `conflict_exhausted`, surfaced, never silently
 *   discarded.
 * - Any other `reason` value -> surfaced as unrecognized. An unknown value has no safe default in
 *   either direction: guessing `conflict` burns retry budget on something that can never land;
 *   guessing `unsupported_operation` discards a real edit that might have succeeded.
 *
 * `isStalled` on the `conflict_progress` branch answers a SEPARATE question from the attempt cap:
 * whether this operation has been losing a race -- progressing or not -- for longer than
 * `STALLED_OPERATION_VISIBILITY_THRESHOLD_MS`. It never changes the classification's outcome
 * (the operation stays queued and keeps retrying either way); it only tells the wiring layer to
 * also record a diagnostic event.
 */
export function classifyRejectedOperation(
  params: ClassifyRejectedOperationParams,
): RejectedOperationClassification {
  const { appliedOperation, storedBridgeModifiedAt, currentAttemptCount, operationCreatedAt, now } =
    params;

  if (appliedOperation.reason === REASON_UNSUPPORTED_OPERATION) {
    return { kind: 'unsupported' };
  }

  if (appliedOperation.reason !== REASON_CONFLICT) {
    return { kind: 'unrecognized_reason', reason: appliedOperation.reason };
  }

  if (appliedOperation.modified_at === undefined) {
    return { kind: 'conflict_missing_token' };
  }

  const bridgeModifiedAt = appliedOperation.modified_at;
  const tokenAdvanced = bridgeModifiedAt !== storedBridgeModifiedAt;
  const nextAttemptCount = tokenAdvanced ? 0 : currentAttemptCount + 1;

  if (!tokenAdvanced && nextAttemptCount >= CONFLICT_ATTEMPT_CAP) {
    return { kind: 'conflict_exhausted', bridgeModifiedAt, nextAttemptCount };
  }

  return {
    kind: 'conflict_progress',
    bridgeModifiedAt,
    nextAttemptCount,
    isStalled: isOperationStalled(operationCreatedAt, now),
  };
}

/**
 * Reports whether an operation has been queued for at least `STALLED_OPERATION_VISIBILITY_THRESHOLD_MS`
 * without landing. Pure age check -- deliberately independent of `CONFLICT_ATTEMPT_CAP`, which a
 * progressing conflict never reaches (see the module doc above for why both bounds are needed).
 */
export function isOperationStalled(operationCreatedAt: number, now: number): boolean {
  return now - operationCreatedAt >= STALLED_OPERATION_VISIBILITY_THRESHOLD_MS;
}

/** One resolved write action for a rejected operation that must persist a bridge-authored token. */
export interface ConflictOutcome {
  readonly operationId: number;
  readonly animeId: string;
  readonly bridgeModifiedAt: number;
  readonly conflictAttemptCount: number;
  readonly status: 'pending' | 'conflict_exhausted';
}

/** Input to `classifyUnconfirmedOperations`. */
export interface ClassifyUnconfirmedOperationsParams {
  /** Operation ids from this batch that `getConfirmedOperationIds` did not confirm. */
  readonly unconfirmedIds: readonly number[];
  /** The full batch this cycle read, used to resolve each id back to its row. */
  readonly pendingOps: readonly OperationLogRow[];
  /** The bridge's raw `applied_operations[]` for this response. */
  readonly appliedOperations: readonly ReconcileAppliedOperation[];
  /** Each anime's stored token as read before this cycle's request was sent. */
  readonly bridgeTokensByAnimeId: ReadonlyMap<string, number | null>;
  /** The instant this response is being processed, injected for deterministic tests. */
  readonly now: number;
}

/** The three write-shaped buckets `syncPendingOperations` turns into `operation_log`/`animes` writes. */
export interface ClassifyUnconfirmedOperationsResult {
  /** Ids with no rejection evidence, or a rejection the classifier deliberately did not act on
   * (`conflict_missing_token`/`unrecognized_reason`, both surfaced via a diagnostic event) --
   * these fall through to the generic "reset to pending" bulk write Part 1 always used. */
  readonly remainingUnconfirmedIds: number[];
  /** Ids whose `reason: "unsupported_operation"` makes them terminal on this first response. */
  readonly deadLetterIds: number[];
  /** Ids whose `reason: "conflict"` resolved to a token write plus a status/counter update. */
  readonly conflictOutcomes: ConflictOutcome[];
}

/**
 * Classifies every unconfirmed operation in a batch against the bridge's `applied_operations[]`,
 * routing each into exactly one of three write-shaped buckets `syncPendingOperations` consumes
 * inside its write door. Pure with respect to SQLite (it touches no database), but DOES record
 * diagnostic events for the two classifier outcomes that are surfaced rather than acted on --
 * that write targets only the in-memory ring (`sync-diagnostic-store`), never the DB, so it stays
 * safe to run here, outside any transaction (design.md Decision 6).
 *
 * Extracted out of `reconcile.helpers.ts`'s `performSyncPendingOperations` to keep that function's
 * cognitive complexity under threshold (constraint: "Complexity Budget Note").
 */
export function classifyUnconfirmedOperations(
  params: ClassifyUnconfirmedOperationsParams,
): ClassifyUnconfirmedOperationsResult {
  const { unconfirmedIds, pendingOps, appliedOperations, bridgeTokensByAnimeId, now } = params;
  const remainingUnconfirmedIds: number[] = [];
  const deadLetterIds: number[] = [];
  const conflictOutcomes: ConflictOutcome[] = [];
  const pendingOpById = new Map(pendingOps.map((operation) => [operation.id, operation]));
  const rejectedEntriesByKey = new Map(
    appliedOperations.reduce<[string, ReconcileAppliedOperation][]>((entries, candidate) => {
      if (candidate.applied === false) {
        entries.push([`${candidate.anime_id}:${candidate.operation}`, candidate]);
      }

      return entries;
    }, []),
  );

  for (const operationId of unconfirmedIds) {
    const operation = pendingOpById.get(operationId);
    const rejectedEntry = operation
      ? rejectedEntriesByKey.get(`${operation.animeId}:${operation.operation}`)
      : undefined;

    if (!operation || !rejectedEntry) {
      remainingUnconfirmedIds.push(operationId);
      continue;
    }

    const classification = classifyRejectedOperation({
      appliedOperation: rejectedEntry,
      storedBridgeModifiedAt: bridgeTokensByAnimeId.get(operation.animeId) ?? null,
      currentAttemptCount: operation.conflictAttemptCount,
      operationCreatedAt: operation.createdAt,
      now,
    });

    switch (classification.kind) {
      case 'unsupported':
        deadLetterIds.push(operationId);
        break;
      case 'conflict_progress':
        conflictOutcomes.push({
          operationId,
          animeId: operation.animeId,
          bridgeModifiedAt: classification.bridgeModifiedAt,
          conflictAttemptCount: classification.nextAttemptCount,
          status: 'pending',
        });
        if (classification.isStalled) {
          recordDiagnosticEvent({
            source: 'reconcile_conflict',
            event: 'conflict_operation_stalled',
            cause: null,
            at: now,
          });
        }
        break;
      case 'conflict_exhausted':
        conflictOutcomes.push({
          operationId,
          animeId: operation.animeId,
          bridgeModifiedAt: classification.bridgeModifiedAt,
          conflictAttemptCount: classification.nextAttemptCount,
          status: 'conflict_exhausted',
        });
        break;
      case 'conflict_missing_token':
        recordDiagnosticEvent({
          source: 'reconcile_conflict',
          event: 'conflict_token_missing',
          cause: null,
          at: now,
        });
        remainingUnconfirmedIds.push(operationId);
        break;
      case 'unrecognized_reason':
        recordDiagnosticEvent({
          source: 'reconcile_conflict',
          event: 'conflict_reason_unrecognized',
          cause: null,
          at: now,
        });
        remainingUnconfirmedIds.push(operationId);
        break;
    }
  }

  return { remainingUnconfirmedIds, deadLetterIds, conflictOutcomes };
}
