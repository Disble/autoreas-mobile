import { eq, inArray } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient } from '../../infrastructure/api';
import {
  mapWireAnimeToLegacyAnime,
  normalizeWireAnimeChangedFields,
} from '../../infrastructure/validation/anime-schema/anime-wire.helpers';
import {
  getBridgeConfigSnapshot,
  withLocalWrite,
} from '../../infrastructure/db/client/client.helpers';
import { persistConfirmedAnimeTokens } from '../../infrastructure/db/anime-repository';
import { bridgeConfig, operationLog } from '../../infrastructure/db/schema';
import { collectConfirmedAnimeTokens } from './applied-operation-token.helpers';
import {
  getLastChangelogId,
  shouldPersistLastChangelogId,
} from './last-changelog.helpers';
import { applyRemoteChanges } from './merge/apply-remote-changes.helpers';
import { loadGuardMap, loadPendingOutboxRecordIds } from './merge/merge-context.helpers';
import type { RemoteAnimeChange } from './merge/merge.types';
import { readOperationLogBacklog } from './operation-log-retention.helpers';
import { stagePendingRemoteChanges } from './pending-remote-changes.helpers';
import { getConfirmedOperationIds } from './reconcile-confirmation.helpers';
import { buildReconcileRequestBody } from './reconcile-request.helpers';
import {
  RECONCILE_BACKLOG_BATCH_LIMIT,
  syncStateByDatabase,
} from './reconcile.constants';
import { ReconcileHttpError } from './reconcile.errors';
import { ReconcileResponseSchema, type ReconcileAnimeChange } from './reconcile.schema';
import type {
  ReconcileApplyMode,
  ReconcileTelemetryContext,
  SyncPendingOperationsResult,
} from './reconcile.types';
import {
  buildSyncCycleTelemetry,
  resolveClientTelemetry,
} from './sync-telemetry.helpers';

/**
 * Separates the failures that retrying can never fix from the ones it can.
 * Only a 4xx means the bridge rejected THIS batch's content, so those rows go to `dead_letter`;
 * everything else -- 5xx, transport, timeouts -- is the network or the bridge being temporarily
 * unavailable and must go back to `pending`. Widening this predicate silently discards local
 * edits that would have synced on the next attempt.
 */
function isPermanentReconcileError(error: unknown): error is ReconcileHttpError {
  return error instanceof ReconcileHttpError && error.status >= 400 && error.status < 500;
}

/**
 * Logs the failed request next to the response that rejected it.
 * The bridge's body names what was wrong but not what was sent, so a status alone is not
 * diagnosable after the fact -- the body we posted is the half that identifies the offending
 * operation.
 */
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
  telemetryContext?: ReconcileTelemetryContext,
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
      const batch = await performSyncPendingOperations(rawDb, applyMode, telemetryContext);

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
    changedFields: normalizeWireAnimeChangedFields(change.changed_fields),
    snapshot: change.snapshot ? mapWireAnimeToLegacyAnime(change.snapshot) : undefined,
    timestamp: change.timestamp,
  };
}

/**
 * Runs exactly ONE reconcile round-trip; the rerun loop and the in-flight guard belong to
 * `syncPendingOperations`, so this stays a single, restartable unit of work.
 *
 * The backlog is claimed as `processing` BEFORE the request and released in the catch, which is
 * what keeps a crash from being indistinguishable from success: every row is either confirmed,
 * requeued, or dead-lettered by the time this returns or throws. Nothing is left claimed by a
 * cycle that is no longer running.
 */
async function performSyncPendingOperations(
  rawDb: SQLiteDatabase,
  applyMode: ReconcileApplyMode,
  telemetryContext?: ReconcileTelemetryContext,
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
    await withLocalWrite(rawDb, async (writeDb) => {
      await writeDb
        .update(operationLog)
        .set({ status: 'processing' })
        .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
    });
  }

  const connection = { ip: config.ip, port: config.port, token: config.token };
  const lastChangelogId = getLastChangelogId(config);
  // The caller supplies what only it can know (the pre-write snapshot, the trigger, the cycle
  // id); this supplies what only it knows (how many operations and which cursor). Passing the
  // config through means the user's kill switch is evaluated at the single serialization point.
  const clientTelemetry = telemetryContext
    ? resolveClientTelemetry(
        buildSyncCycleTelemetry({
          cycleId: telemetryContext.cycleId,
          triggerSource: telemetryContext.triggerSource,
          appState: telemetryContext.appState,
          snapshot: telemetryContext.snapshot,
          pendingOpsCount: pendingOps.length,
          cursor: lastChangelogId,
          recentEvents: telemetryContext.recentEvents,
        }),
        config,
      )
    : null;
  const requestBody = buildReconcileRequestBody(
    config.deviceId ?? undefined,
    lastChangelogId,
    pendingOps,
    clientTelemetry,
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
    // Pure, computed OUTSIDE the write door: `applied_operations` is the only valid token
    // source (never `bridge_changes[].snapshot.modified_at`, which the bridge hardcodes to 0 --
    // see design.md invariant 1 / Decision 2).
    const confirmedAnimeTokens = collectConfirmedAnimeTokens(applied_operations);
    const confirmedIds = getConfirmedOperationIds(
      pendingOps,
      applied_operations,
      bridge_changes,
    );
    const confirmedIdSet = new Set(confirmedIds);
    const unconfirmedIds: number[] = [];

    for (const operation of pendingOps) {
      if (!confirmedIdSet.has(operation.id)) {
        unconfirmedIds.push(operation.id);
      }
    }

    const normalizedChanges = bridge_changes.map(normalizeBridgeChange);

    // Route every pulled bridge change through the single merge boundary instead of the old
    // full-row clobber, on the one shared write door regardless of mode. `applyMode` selects
    // WHICH TABLE is written, not the transaction mechanism:
    // - 'deferred' (foreground): writes `animes` directly, so local `useLiveQuery` consumers
    //   observe the new data immediately.
    // - 'staged' (background/headless): never touches `animes`; stages into
    //   `pending_remote_changes` instead, deferring the real apply to the foreground drain
    //   hook. Non-reactivity comes from the caller's own connection (`enableChangeListener:
    //   false`), not from a different transaction path here (design.md Decision 4).
    // Op-log status writes and the changelog cursor advance stay in the same transaction in
    // both modes so confirmation/cursor bookkeeping never drifts from the apply outcome.
    await withLocalWrite(rawDb, async (writeDb) => {
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

      // MUST run after the `bridge_changes` apply above: that apply may be what CREATES the
      // row (an `update` for a record the device has never seen falls through to `upsertAnime`),
      // and a token write against a not-yet-existing row matches zero rows. Column-disjoint from
      // the write above (`bridge_modified_at` only, design.md Decision 2), so ordering here is a
      // row-existence dependency, never a conflict to resolve.
      await persistConfirmedAnimeTokens(writeDb, confirmedAnimeTokens);

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
      await withLocalWrite(rawDb, async (writeDb) => {
        await writeDb
          .update(operationLog)
          .set({ status: isPermanentReconcileError(error) ? 'dead_letter' : 'pending' })
          .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
      });
    }

    throw error;
  }
}
