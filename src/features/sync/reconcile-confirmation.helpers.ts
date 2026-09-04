import type { OperationLogRow } from '../../infrastructure/db/schema';
import { normalizePendingOperationPayload } from './reconcile-request.helpers';
import type { ReconcileAppliedOperation, ReconcileAnimeChange } from './reconcile.schema';

/**
 * Returns only the operation ids that the bridge response confirms as applied.
 * This prevents mobile from marking rows as synced after a superficial 202 without business evidence.
 */
export function getConfirmedOperationIds(
  processingOperations: OperationLogRow[],
  appliedOperations: ReconcileAppliedOperation[] | undefined,
  bridgeChanges: ReconcileAnimeChange[],
): number[] {
  const confirmedIds: number[] = [];

  for (const operation of processingOperations) {
    if (isOperationConfirmed(operation, appliedOperations, bridgeChanges)) {
      confirmedIds.push(operation.id);
    }
  }

  return confirmedIds;
}

/**
 * Decides whether one outbox row has real evidence of having landed on the bridge.
 * `applied_operations` is the explicit ack and always wins, but it is optional in the contract,
 * so when it is absent the only remaining evidence is the pulled `bridge_changes` themselves:
 * every field this row sent must show up in the change's `changed_fields` or already match its
 * snapshot. A payload with no fields carries nothing to evidence, so it can never be confirmed
 * by inference -- guessing there would mark an unsent row as synced and lose the edit.
 */
function isOperationConfirmed(
  operation: OperationLogRow,
  appliedOperations: ReconcileAppliedOperation[] | undefined,
  bridgeChanges: ReconcileAnimeChange[],
): boolean {
  const appliedOperation = appliedOperations?.find(
    (candidate) =>
      candidate.anime_id === operation.animeId &&
      candidate.operation === operation.operation,
  );

  if (appliedOperation) {
    return appliedOperation.applied;
  }

  const payload = normalizePendingOperationPayload(operation.operation, operation.payload);
  const payloadKeys = Object.keys(payload);

  if (payloadKeys.length === 0) {
    return false;
  }

  return bridgeChanges.some((change) => {
    if (change.record_id !== operation.animeId || change.change_type === 'delete') {
      return false;
    }

    const snapshot = change.snapshot as Record<string, unknown> | undefined;

    return payloadKeys.every(
      (field) =>
        change.changed_fields.includes(field) ||
        snapshot?.[field] === payload[field],
    );
  });
}
