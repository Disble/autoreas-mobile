import type { OperationLogRow } from '../../infrastructure/db/schema';
import type { ReconcileAnimeChange } from './reconcile.schema';

/**
 * Builds the reconcile request body from persisted operation-log rows.
 * Keeping this serialization pure makes the network workflow easier to test and evolve.
 */
export function buildReconcileRequestBody(
  deviceId: string | undefined,
  lastChangelogId: number,
  pendingOperations: OperationLogRow[],
) {
  return {
    device_id: deviceId ?? undefined,
    last_changelog_id: lastChangelogId,
    pending_operations: pendingOperations.map((operation) => ({
      anime_id: operation.animeId,
      operation: operation.operation,
      payload: parseOperationPayload(operation.payload),
      created_at: operation.createdAt,
    })),
  };
}

/**
 * Returns only the operation ids that the bridge response confirms as applied.
 * This prevents mobile from marking rows as synced after a superficial 202 without business evidence.
 */
export function getConfirmedOperationIds(
  processingOperations: OperationLogRow[],
  bridgeChanges: ReconcileAnimeChange[],
): number[] {
  return processingOperations
    .filter((operation) => isOperationConfirmed(operation, bridgeChanges))
    .map((operation) => operation.id);
}

function isOperationConfirmed(
  operation: OperationLogRow,
  bridgeChanges: ReconcileAnimeChange[],
): boolean {
  const payload = parseOperationPayload(operation.payload);
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

function parseOperationPayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}
