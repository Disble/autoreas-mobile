import { eq, inArray } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient } from '../../infrastructure/api';
import {
  getBridgeConfigSnapshot,
  withDeferredWrite,
  withExclusiveWrite,
} from '../../infrastructure/db/client';
import {
  bridgeConfig,
  operationLog,
  type OperationLogRow,
} from '../../infrastructure/db/schema';
import {
  getLastChangelogId,
  shouldPersistLastChangelogId,
} from './last-changelog.helpers';
import { applyRemoteChanges, loadGuardMap, loadPendingOutboxRecordIds } from './merge';
import type { RemoteAnimeChange } from './merge';
import { readOperationLogBacklog } from './operation-log-retention.helpers';
import { stagePendingRemoteChanges } from './pending-remote-changes.helpers';
import {
  RECONCILE_BACKLOG_BATCH_LIMIT,
  syncStateByDatabase,
} from './reconcile.constants';
import {
  type ReconcileAppliedOperation,
  ReconcileResponseSchema,
  type ReconcileAnimeChange,
} from './reconcile.schema';
import type { ReconcileApplyMode, SyncPendingOperationsResult } from './reconcile.types';

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
 * It reads a bounded backlog of pending rows, confirms only evidenced operations, reapplies bridge changes,
 * and advances the changelog cursor without regressing it.
 *
 * `applyMode` selects where pulled `bridge_changes` land: `'deferred'` (default) applies
 * directly to `animes` on the shared reactive connection for foreground callers; `'staged'`
 * writes into `pending_remote_changes` instead, for callers running on the isolated
 * non-reactive background connection (the headless sync cycle). Passing the wrong mode for
 * a background connection silently reintroduces the non-reactive-write regression, so
 * callers must derive it explicitly rather than relying on the default.
 */
export async function syncPendingOperations(
  rawDb: SQLiteDatabase,
  applyMode: ReconcileApplyMode = 'deferred',
): Promise<SyncPendingOperationsResult> {
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

  const run = async (): Promise<SyncPendingOperationsResult> => {
    let totalConfirmed = 0;
    let totalBacklogRead = 0;
    let hasMorePending: boolean;

    do {
      syncState.rerunRequested = false;
      const batch = await performSyncPendingOperations(rawDb, applyMode);

      totalConfirmed += batch.syncedCount;
      totalBacklogRead += batch.backlogReadCount;
      hasMorePending = batch.hasMorePending;
    } while (syncState.rerunRequested);

    return {
      syncedCount: totalConfirmed,
      backlogReadCount: totalBacklogRead,
      hasMorePending,
    };
  };

  syncState.inFlight = run().finally(() => {
    syncState.inFlight = null;
    syncState.rerunRequested = false;
  });
  syncStateByDatabase.set(syncKey, syncState);

  return syncState.inFlight;
}

/**
 * Normalizes a wire-shape `ReconcileAnimeChange` into the merge boundary's `RemoteAnimeChange`
 * DTO. Reconcile is the "rich" entry shape (carries `changed_fields` + `timestamp` always).
 */
function normalizeBridgeChange(change: ReconcileAnimeChange): RemoteAnimeChange {
  return {
    recordId: change.record_id,
    changeType: change.change_type,
    changedFields: change.changed_fields,
    snapshot: change.snapshot,
    timestamp: change.timestamp,
  };
}

async function performSyncPendingOperations(
  rawDb: SQLiteDatabase,
  applyMode: ReconcileApplyMode,
): Promise<SyncPendingOperationsResult> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    throw new Error('Bridge config is missing or incomplete');
  }

  // Include 'processing' so operations orphaned by a cycle that died mid-flight (crash, app
  // kill, an earlier transport failure) are recovered: they get re-sent and confirmed instead
  // of staying stuck in 'processing' forever. A stuck 'processing' op is poisonous because
  // `loadPendingOutboxRecordIds` treats it as un-acked local intent and `defer_outbox` then
  // drops EVERY remote change for that anime, freezing it permanently out of sync. Re-sending
  // is safe: cycles are serialized per connection and the patches are absolute/idempotent.
  const pendingOps = await readOperationLogBacklog(rawDb, {
    status: ['pending', 'processing'],
    limit: RECONCILE_BACKLOG_BATCH_LIMIT,
    orderBy: 'oldest_first',
  });

  if (pendingOps.length > 0) {
    await withExclusiveWrite(rawDb, async (writeDb) => {
      await writeDb
        .update(operationLog)
        .set({ status: 'processing' })
        .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
    });
  }

  const connection = { ip: config.ip, port: config.port, token: config.token };
  const lastChangelogId = getLastChangelogId(config);
  const requestBody = buildReconcileRequestBody(
    config.deviceId ?? undefined,
    lastChangelogId,
    pendingOps,
  );

  try {
    const result = await bridgeClient.reconcile(connection, requestBody);

    if (!result.ok) {
      const error = new ReconcileHttpError(result.status, result.rawBody);

      logReconcileHttpError(result.url, requestBody, error);
      throw error;
    }

    const parsed = ReconcileResponseSchema.safeParse(result.data);

    if (!parsed.success) {
      throw new Error(`Invalid reconcile response: ${parsed.error.message}`);
    }

    const {
      applied_operations,
      bridge_changes,
      last_changelog_id: responseLastChangelogId,
    } = parsed.data;
    const nextLastChangelogId = responseLastChangelogId ?? lastChangelogId;
    const confirmedIds = getConfirmedOperationIds(
      pendingOps,
      applied_operations,
      bridge_changes,
    );
    const unconfirmedIds = pendingOps
      .map((operation) => operation.id)
      .filter((id) => !confirmedIds.includes(id));

    const normalizedChanges = bridge_changes.map(normalizeBridgeChange);

    // Route every pulled bridge change through the single merge boundary instead of the old
    // full-row clobber. `applyMode` selects the write sink:
    // - 'deferred' (foreground): writes `animes` on the shared reactive connection inside
    //   `withDeferredWrite`, so local `useLiveQuery` consumers observe the new data
    //   immediately.
    // - 'staged' (background/headless): never touches `animes`; stages into
    //   `pending_remote_changes` on the isolated non-reactive connection instead, deferring
    //   the real apply to the foreground drain hook. This is what makes the background
    //   runtime safe to run on a connection that cannot fire change notifications.
    // Op-log status writes and the changelog cursor advance stay in the same transaction in
    // both modes so confirmation/cursor bookkeeping never drifts from the apply outcome.
    const applyChangesInTransaction = applyMode === 'staged' ? withExclusiveWrite : withDeferredWrite;

    await applyChangesInTransaction(rawDb, async (writeDb) => {
      if (applyMode === 'staged') {
        await stagePendingRemoteChanges(writeDb, normalizedChanges);
      } else {
        const recordIds = normalizedChanges.map((change) => change.recordId);
        const [guardByRecordId, pendingOutboxRecordIds] = await Promise.all([
          loadGuardMap(writeDb, recordIds),
          loadPendingOutboxRecordIds(writeDb),
        ]);

        await applyRemoteChanges(
          writeDb,
          normalizedChanges,
          { guardByRecordId, pendingOutboxRecordIds },
          'deferred',
        );
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

    return {
      syncedCount: confirmedIds.length,
      backlogReadCount: pendingOps.length,
      hasMorePending:
        unconfirmedIds.length > 0 ||
        pendingOps.length === RECONCILE_BACKLOG_BATCH_LIMIT,
    };
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
