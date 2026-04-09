import { eq, inArray } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { upsertAnime } from '../../infrastructure/db/anime-repository';
import {
  getBridgeConfigSnapshot,
  withExclusiveWrite,
} from '../../infrastructure/db/client';
import {
  animes,
  bridgeConfig,
  operationLog,
  type OperationLogRow,
} from '../../infrastructure/db/schema';
import {
  getLastChangelogId,
  shouldPersistLastChangelogId,
} from './last-changelog.helpers';
import { syncStateByDatabase } from './reconcile.constants';
import {
  type ReconcileAppliedOperation,
  ReconcileResponseSchema,
  type ReconcileAnimeChange,
} from './reconcile.schema';

class ReconcileHttpError extends Error {
  readonly status: number;
  readonly responseBody: string | null;

  constructor(status: number, responseBody: string | null) {
    super(`Reconcile failed: ${status}`);
    this.name = 'ReconcileHttpError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

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
  appliedOperations: ReconcileAppliedOperation[] | undefined,
  bridgeChanges: ReconcileAnimeChange[],
): number[] {
  return processingOperations
    .filter((operation) => isOperationConfirmed(operation, appliedOperations, bridgeChanges))
    .map((operation) => operation.id);
}

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

function isPermanentReconcileError(error: unknown): error is ReconcileHttpError {
  return error instanceof ReconcileHttpError && error.status >= 400 && error.status < 500;
}

async function readResponseBody(response: Response): Promise<string | null> {
  if (typeof response.text !== 'function') {
    return null;
  }

  const body = await response.text();

  return body.length > 0 ? body : null;
}

function logReconcileHttpError(
  url: string,
  requestBody: ReturnType<typeof buildReconcileRequestBody>,
  error: ReconcileHttpError,
) {
  console.warn('[syncPendingOperations] Reconcile request failed', {
    url,
    requestBody,
    status: error.status,
    responseBody: error.responseBody,
  });
}

/**
 * Orchestrates the mobile reconcile cycle against the bridge using a per-database in-flight guard.
 * It moves pending rows to processing, confirms only evidenced operations, reapplies bridge changes, and advances the changelog cursor without regressing it.
 */
export async function syncPendingOperations(rawDb: SQLiteDatabase) {
  const syncKey = rawDb as object;
  const syncState = syncStateByDatabase.get(syncKey) ?? {
    inFlight: null,
    rerunRequested: false,
  };

  if (syncState.inFlight) {
    syncState.rerunRequested = true;
    syncStateByDatabase.set(syncKey, syncState);
    return syncState.inFlight;
  }

  const run = async (): Promise<number> => {
    let totalConfirmed = 0;

    do {
      syncState.rerunRequested = false;
      totalConfirmed += await performSyncPendingOperations(rawDb);
    } while (syncState.rerunRequested);

    return totalConfirmed;
  };

  syncState.inFlight = run().finally(() => {
    syncState.inFlight = null;
    syncState.rerunRequested = false;
  });
  syncStateByDatabase.set(syncKey, syncState);

  return syncState.inFlight;
}

async function performSyncPendingOperations(rawDb: SQLiteDatabase) {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    throw new Error('Bridge config is missing or incomplete');
  }

  let pendingOps: OperationLogRow[] = [];

  await withExclusiveWrite(rawDb, async (writeDb) => {
    pendingOps = await writeDb
      .select()
      .from(operationLog)
      .where(eq(operationLog.status, 'pending'));

    if (pendingOps.length === 0) {
      return;
    }

    await writeDb
      .update(operationLog)
      .set({ status: 'processing' })
      .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
  });

  const baseUrl = `http://${config.ip}:${config.port}`;
  const reconcileUrl = `${baseUrl}/api/sync/reconcile`;
  const lastChangelogId = getLastChangelogId(config);
  const requestBody = buildReconcileRequestBody(
    config.deviceId ?? undefined,
    lastChangelogId,
    pendingOps,
  );

  try {
    const response = await fetch(reconcileUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const responseBody = await readResponseBody(response);
      const error = new ReconcileHttpError(response.status, responseBody);

      logReconcileHttpError(reconcileUrl, requestBody, error);
      throw error;
    }

    const raw = await response.json();
    const parsed = ReconcileResponseSchema.safeParse(raw);

    if (!parsed.success) {
      throw new Error(`Invalid reconcile response: ${parsed.error.message}`);
    }

    const {
      applied_operations,
      bridge_changes,
      last_changelog_id: responseLastChangelogId,
    } = parsed.data;
    const nextLastChangelogId = bridge_changes.reduce((max, change) => {
      return Math.max(max, change.timestamp);
    }, responseLastChangelogId ?? lastChangelogId);
    const confirmedIds = getConfirmedOperationIds(
      pendingOps,
      applied_operations,
      bridge_changes,
    );
    const unconfirmedIds = pendingOps
      .map((operation) => operation.id)
      .filter((id) => !confirmedIds.includes(id));

    await withExclusiveWrite(rawDb, async (writeDb) => {
      for (const change of bridge_changes) {
        if (change.change_type === 'delete') {
          await writeDb.delete(animes).where(eq(animes._id, change.record_id));
        } else if (change.snapshot) {
          await upsertAnime(writeDb, change.snapshot);
        }
      }

      if (confirmedIds.length > 0) {
        await writeDb
          .update(operationLog)
          .set({ status: 'synced' })
          .where(inArray(operationLog.id, confirmedIds));
      }

      if (unconfirmedIds.length > 0) {
        await writeDb
          .update(operationLog)
          .set({ status: 'pending' })
          .where(inArray(operationLog.id, unconfirmedIds));
      }

      if (shouldPersistLastChangelogId(lastChangelogId, nextLastChangelogId)) {
        await writeDb
          .update(bridgeConfig)
          .set({ lastChangelogId: nextLastChangelogId })
          .where(eq(bridgeConfig.id, config.id));
      }
    });

    return confirmedIds.length;
  } catch (error) {
    if (pendingOps.length > 0) {
      await withExclusiveWrite(rawDb, async (writeDb) => {
        await writeDb
          .update(operationLog)
          .set({ status: isPermanentReconcileError(error) ? 'dead_letter' : 'pending' })
          .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
      });
    }

    throw error;
  }
}
