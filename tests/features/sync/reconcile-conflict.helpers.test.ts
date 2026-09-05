import {
  CONFLICT_ATTEMPT_CAP,
  STALLED_OPERATION_VISIBILITY_THRESHOLD_MS,
} from '../../../src/features/sync/reconcile-conflict.constants';
import {
  classifyRejectedOperation,
  classifyUnconfirmedOperations,
  isOperationStalled,
} from '../../../src/features/sync/reconcile-conflict.helpers';
import type { ReconcileAppliedOperation } from '../../../src/features/sync/reconcile.schema';
import type { OperationLogRow } from '../../../src/infrastructure/db/schema';

jest.mock('../../../src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers', () => ({
  recordDiagnosticEvent: jest.fn(),
}));

/** Builds a fixture `OperationLogRow` with a definite `conflictAttemptCount`. */
function makeOperationLogRow(overrides: Partial<OperationLogRow> = {}): OperationLogRow {
  return {
    id: 1,
    animeId: 'anime-1',
    operation: 'update',
    payload: '{}',
    status: 'processing',
    createdAt: 0,
    conflictAttemptCount: 0,
    ...overrides,
  } as OperationLogRow;
}

/** Builds a fixture rejected (`applied: false`) `ReconcileAppliedOperation` entry. */
function makeRejectedOperation(
  overrides: Partial<ReconcileAppliedOperation> = {},
): ReconcileAppliedOperation {
  return {
    anime_id: 'anime-1',
    operation: 'update',
    applied: false,
    ...overrides,
  };
}

describe('classifyRejectedOperation', () => {
  it('classifies reason: "unsupported_operation" as terminal, never retried', () => {
    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'unsupported_operation' }),
      storedBridgeModifiedAt: null,
      currentAttemptCount: 0,
      operationCreatedAt: 0,
      now: 0,
    });

    expect(result).toEqual({ kind: 'unsupported' });
  });

  it('classifies an unrecognized reason as surfaced, never bucketed into conflict or unsupported', () => {
    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'some_future_value' }),
      storedBridgeModifiedAt: 100,
      currentAttemptCount: 0,
      operationCreatedAt: 0,
      now: 0,
    });

    expect(result).toEqual({ kind: 'unrecognized_reason', reason: 'some_future_value' });
  });

  it('classifies a conflict whose token advances as progress, resetting the attempt counter to 0', () => {
    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'conflict', modified_at: 200 }),
      storedBridgeModifiedAt: 100,
      currentAttemptCount: 2,
      operationCreatedAt: 0,
      now: 0,
    });

    expect(result).toEqual({
      kind: 'conflict_progress',
      bridgeModifiedAt: 200,
      nextAttemptCount: 0,
      isStalled: false,
    });
  });

  it('sets the token to animes.bridge_modified_at and queues for the NEXT cycle (re-based), never retried inline -- reflected as a progress classification', () => {
    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'conflict', modified_at: 1788540735366 }),
      storedBridgeModifiedAt: null,
      currentAttemptCount: 0,
      operationCreatedAt: 0,
      now: 0,
    });

    expect(result.kind).toBe('conflict_progress');
    expect((result as { bridgeModifiedAt: number }).bridgeModifiedAt).toBe(1788540735366);
  });

  it('increments the attempt counter when a conflict repeats the SAME token (no progress)', () => {
    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'conflict', modified_at: 100 }),
      storedBridgeModifiedAt: 100,
      currentAttemptCount: 1,
      operationCreatedAt: 0,
      now: 0,
    });

    expect(result).toEqual({
      kind: 'conflict_progress',
      bridgeModifiedAt: 100,
      nextAttemptCount: 2,
      isStalled: false,
    });
  });

  it('reaches conflict_exhausted on the 3rd consecutive non-progressing conflict (attempt cap = 3)', () => {
    expect(CONFLICT_ATTEMPT_CAP).toBe(3);

    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'conflict', modified_at: 100 }),
      storedBridgeModifiedAt: 100,
      currentAttemptCount: 2,
      operationCreatedAt: 0,
      now: 0,
    });

    expect(result).toEqual({
      kind: 'conflict_exhausted',
      bridgeModifiedAt: 100,
      nextAttemptCount: 3,
    });
  });

  it('classifies a conflict entry with no modified_at as a contract violation, never defaulted to 0', () => {
    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'conflict' }),
      storedBridgeModifiedAt: 100,
      currentAttemptCount: 0,
      operationCreatedAt: 0,
      now: 0,
    });

    expect(result).toEqual({ kind: 'conflict_missing_token' });
  });

  it('marks a progressing conflict as stalled once the visibility threshold is crossed, while still classifying it as progress (remains queued, keeps retrying)', () => {
    const operationCreatedAt = 0;
    const now = STALLED_OPERATION_VISIBILITY_THRESHOLD_MS;

    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'conflict', modified_at: 300 }),
      storedBridgeModifiedAt: 200,
      currentAttemptCount: 5,
      operationCreatedAt,
      now,
    });

    expect(result).toEqual({
      kind: 'conflict_progress',
      bridgeModifiedAt: 300,
      nextAttemptCount: 0,
      isStalled: true,
    });
  });

  it('does not mark a progressing conflict as stalled before the visibility threshold', () => {
    const result = classifyRejectedOperation({
      appliedOperation: makeRejectedOperation({ reason: 'conflict', modified_at: 300 }),
      storedBridgeModifiedAt: 200,
      currentAttemptCount: 0,
      operationCreatedAt: 0,
      now: STALLED_OPERATION_VISIBILITY_THRESHOLD_MS - 1,
    });

    expect((result as { isStalled: boolean }).isStalled).toBe(false);
  });
});

describe('isOperationStalled', () => {
  it('is false strictly before the threshold and true at/after it', () => {
    expect(isOperationStalled(0, STALLED_OPERATION_VISIBILITY_THRESHOLD_MS - 1)).toBe(false);
    expect(isOperationStalled(0, STALLED_OPERATION_VISIBILITY_THRESHOLD_MS)).toBe(true);
  });
});

describe('classifyUnconfirmedOperations', () => {
  it('routes an unsupported_operation entry to deadLetterIds, never remainingUnconfirmedIds', () => {
    const pendingOps = [makeOperationLogRow({ id: 1, animeId: 'anime-1', operation: 'delete' })];
    const result = classifyUnconfirmedOperations({
      unconfirmedIds: [1],
      pendingOps,
      appliedOperations: [
        { anime_id: 'anime-1', operation: 'delete', applied: false, reason: 'unsupported_operation' },
      ],
      bridgeTokensByAnimeId: new Map(),
      now: 0,
    });

    expect(result.deadLetterIds).toEqual([1]);
    expect(result.remainingUnconfirmedIds).toEqual([]);
    expect(result.conflictOutcomes).toEqual([]);
  });

  it('routes a progressing conflict into conflictOutcomes with status pending', () => {
    const pendingOps = [
      makeOperationLogRow({ id: 2, animeId: 'anime-2', conflictAttemptCount: 1 }),
    ];
    const result = classifyUnconfirmedOperations({
      unconfirmedIds: [2],
      pendingOps,
      appliedOperations: [
        { anime_id: 'anime-2', operation: 'update', applied: false, reason: 'conflict', modified_at: 999 },
      ],
      bridgeTokensByAnimeId: new Map([['anime-2', 100]]),
      now: 0,
    });

    expect(result.conflictOutcomes).toEqual([
      { operationId: 2, animeId: 'anime-2', bridgeModifiedAt: 999, conflictAttemptCount: 0, status: 'pending' },
    ]);
    expect(result.remainingUnconfirmedIds).toEqual([]);
    expect(result.deadLetterIds).toEqual([]);
  });

  it('routes an exhausted conflict into conflictOutcomes with status conflict_exhausted', () => {
    const pendingOps = [
      makeOperationLogRow({ id: 3, animeId: 'anime-3', conflictAttemptCount: 2 }),
    ];
    const result = classifyUnconfirmedOperations({
      unconfirmedIds: [3],
      pendingOps,
      appliedOperations: [
        { anime_id: 'anime-3', operation: 'update', applied: false, reason: 'conflict', modified_at: 100 },
      ],
      bridgeTokensByAnimeId: new Map([['anime-3', 100]]),
      now: 0,
    });

    expect(result.conflictOutcomes).toEqual([
      { operationId: 3, animeId: 'anime-3', bridgeModifiedAt: 100, conflictAttemptCount: 3, status: 'conflict_exhausted' },
    ]);
  });

  it('leaves an operation with no matching rejected entry in remainingUnconfirmedIds', () => {
    const pendingOps = [makeOperationLogRow({ id: 4, animeId: 'anime-4' })];
    const result = classifyUnconfirmedOperations({
      unconfirmedIds: [4],
      pendingOps,
      appliedOperations: [],
      bridgeTokensByAnimeId: new Map(),
      now: 0,
    });

    expect(result.remainingUnconfirmedIds).toEqual([4]);
    expect(result.deadLetterIds).toEqual([]);
    expect(result.conflictOutcomes).toEqual([]);
  });

  it('leaves conflict_missing_token and unrecognized_reason entries in remainingUnconfirmedIds', () => {
    const pendingOps = [
      makeOperationLogRow({ id: 5, animeId: 'anime-5' }),
      makeOperationLogRow({ id: 6, animeId: 'anime-6' }),
    ];
    const result = classifyUnconfirmedOperations({
      unconfirmedIds: [5, 6],
      pendingOps,
      appliedOperations: [
        { anime_id: 'anime-5', operation: 'update', applied: false, reason: 'conflict' },
        { anime_id: 'anime-6', operation: 'update', applied: false, reason: 'some_future_value' },
      ],
      bridgeTokensByAnimeId: new Map(),
      now: 0,
    });

    expect(result.remainingUnconfirmedIds.sort()).toEqual([5, 6]);
  });
});
