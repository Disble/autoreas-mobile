import { eq, inArray } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient } from '../../infrastructure/api';
import {
  mapWireAnimeToLegacyAnime,
  normalizeWireAnimeChangedFields,
} from '../../infrastructure/validation/anime-schema/anime-wire.helpers';
import {
  createDrizzleDb,
  getBridgeConfigSnapshot,
  withLocalWrite,
} from '../../infrastructure/db/client/client.helpers';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import {
  applyAnimeBridgeToken,
  persistConfirmedAnimeTokens,
  readAnimeBridgeTokens,
} from '../../infrastructure/db/anime-repository';
import { bridgeConfig, operationLog } from '../../infrastructure/db/schema';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import type { ConfirmedAnimeToken } from './applied-operation-token.helpers';
import { collectConfirmedAnimeTokens } from './applied-operation-token.helpers';
import {
  getLastChangelogId,
  shouldPersistLastChangelogId,
} from './last-changelog.helpers';
import { applyRemoteChanges } from './merge/apply-remote-changes.helpers';
import { loadGuardMap, loadPendingOutboxRecordIds } from './merge/merge-context.helpers';
import type { RemoteAnimeChange } from './merge/merge.types';
import {
  countOperationLogBacklogRows,
  readOperationLogBacklog,
} from './operation-log-retention.helpers';
import { stagePendingRemoteChanges } from './pending-remote-changes.helpers';
import { getConfirmedOperationIds } from './reconcile-confirmation.helpers';
import type { ConflictOutcome } from './reconcile-conflict.helpers';
import { classifyUnconfirmedOperations } from './reconcile-conflict.helpers';
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
  captureSyncDiagnosticsEnvelope,
  flushSyncDiagnosticsOutbox,
} from './sync-diagnostics-flush.helpers';
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

/** Input to `applyReconcileResponseWrites`, one field per write source this cycle produced. */
interface ApplyReconcileResponseWritesParams {
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
}

/**
 * Applies every write this cycle's response produced, all inside the ONE shared write door the
 * caller already opened. Extracted out of `performSyncPendingOperations` to keep that function's
 * cognitive complexity under threshold (constraint: "Complexity Budget Note") -- this function
 * owns nothing about WHEN to run (that stays `withLocalWrite`'s job), only WHAT to write and in
 * what order, per design.md Decision 1/2 (extended to Part 2's conflict outcomes, which are
 * column-disjoint from the confirmed write-back and so carry no ordering dependency against it).
 */
async function applyReconcileResponseWrites(
  writeDb: AppDatabase,
  params: ApplyReconcileResponseWritesParams,
): Promise<void> {
  const {
    applyMode,
    normalizedChanges,
    confirmedAnimeTokens,
    conflictOutcomes,
    deadLetterIds,
    confirmedIds,
    remainingUnconfirmedIds,
    lastChangelogId,
    nextLastChangelogId,
    bridgeConfigId,
  } = params;

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

  // MUST run after the `bridge_changes` apply above: that apply may be what CREATES the row
  // (an `update` for a record the device has never seen falls through to `upsertAnime`), and a
  // token write against a not-yet-existing row matches zero rows. Column-disjoint from the write
  // above (`bridge_modified_at` only, design.md Decision 2), so ordering here is a row-existence
  // dependency, never a conflict to resolve.
  await persistConfirmedAnimeTokens(writeDb, confirmedAnimeTokens);

  for (const outcome of conflictOutcomes) {
    // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: every write shares the caller's already-open write door on one SQLite connection.
    await applyAnimeBridgeToken(writeDb, outcome.animeId, outcome.bridgeModifiedAt);
    await writeDb
      .update(operationLog)
      .set({ status: outcome.status, conflictAttemptCount: outcome.conflictAttemptCount })
      .where(eq(operationLog.id, outcome.operationId));
  }

  if (deadLetterIds.length > 0) {
    await writeDb
      .update(operationLog)
      .set({ status: 'dead_letter' })
      .where(inArray(operationLog.id, deadLetterIds as number[]));
  }

  if (confirmedIds.length > 0) {
    await writeDb
      .update(operationLog)
      .set({ status: 'synced' })
      .where(inArray(operationLog.id, confirmedIds as number[]));
  }

  if (remainingUnconfirmedIds.length > 0) {
    await writeDb
      .update(operationLog)
      .set({ status: 'pending' })
      .where(inArray(operationLog.id, remainingUnconfirmedIds as number[]));
  }

  if (shouldPersistLastChangelogId(lastChangelogId, nextLastChangelogId)) {
    await writeDb
      .update(bridgeConfig)
      .set({ lastChangelogId: nextLastChangelogId })
      .where(eq(bridgeConfig.id, bridgeConfigId));
  }
}

/**
 * Reverts a batch claimed `'processing'` back to a retry-eligible state after this cycle failed,
 * or moves it to `dead_letter` when the bridge's own 4xx response says the batch's CONTENT was
 * rejected (see `isPermanentReconcileError`). No-ops for an empty batch. Extracted out of
 * `performSyncPendingOperations`'s `catch` block to keep that function's cognitive complexity
 * under threshold (constraint: "Complexity Budget Note").
 */
async function revertPendingOperationsOnFailure(
  rawDb: SQLiteDatabase,
  pendingOps: readonly OperationLogRow[],
  error: unknown,
): Promise<void> {
  if (pendingOps.length === 0) {
    return;
  }

  await withLocalWrite(rawDb, async (writeDb) => {
    await writeDb
      .update(operationLog)
      .set({ status: isPermanentReconcileError(error) ? 'dead_letter' : 'pending' })
      .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
  });
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
  // `dedupeBy: 'anime_id'` (design.md Decision 9, Requirement 10) caps the batch at one queued
  // operation per anime -- the oldest by `created_at`/`id` -- so `limit` bounds distinct animes
  // rather than rows here.
  const pendingOps = await readOperationLogBacklog(rawDb, {
    status: ['pending', 'processing'],
    limit: RECONCILE_BACKLOG_BATCH_LIMIT,
    orderBy: 'oldest_first',
    dedupeBy: 'anime_id',
  });

  // Reported-value only (design.md Decision 9): under `dedupeBy: 'anime_id'`, `pendingOps.length`
  // counts distinct animes batched, not rows queued, so it alone cannot tell whether more rows
  // are waiting behind the ones this batch suppressed. This total is read once per cycle purely
  // so `hasMorePending` stays truthful; it never drives the rerun loop, which is
  // `syncState.rerunRequested` alone.
  const totalBacklogRowCount = pendingOps.length > 0
    ? await countOperationLogBacklogRows(rawDb, ['pending', 'processing'])
    : 0;

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
  // Read-only, outside any write door: the SAME shape `getBridgeConfigSnapshot` uses for its own
  // read. This is the value each operation's `base` is built from (Requirement 9) -- read here,
  // before the request goes out, so it reflects the token as of the moment this batch was sent.
  const bridgeTokensByAnimeId = await readAnimeBridgeTokens(
    createDrizzleDb(rawDb),
    pendingOps.map((operation) => operation.animeId),
  );
  const requestBody = buildReconcileRequestBody(
    config.deviceId ?? undefined,
    lastChangelogId,
    pendingOps,
    clientTelemetry,
    bridgeTokensByAnimeId,
  );

  // Both calls sit here, lexically BEFORE the `try` below and outside any `withLocalWrite`
  // callback (design.md Decision 5). `captureSyncDiagnosticsEnvelope` is synchronous and
  // swallows by contract; `flushSyncDiagnosticsOutbox` never rejects. Placement, not the
  // never-rejecting contract alone, is what makes a diagnostics-delivery failure unreachable
  // from the `catch` below: that `catch` calls `revertPendingOperationsOnFailure`, which would
  // otherwise dead-letter or requeue the user's own pending mutations over a diagnostics POST.
  captureSyncDiagnosticsEnvelope(clientTelemetry);
  await flushSyncDiagnosticsOutbox({ connection });

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

    // Pure classification pass, outside the write door: for every unconfirmed operation with a
    // matching REJECTED (`applied: false`) entry, decide what it means (design.md Decision 6).
    // `remainingUnconfirmedIds` is the generic "reset to pending" bucket that Part 1 always used;
    // `deadLetterIds`/`conflictOutcomes` get their own explicit write inside the door instead, so
    // they must NOT also be swept into the generic bulk reset below.
    const { remainingUnconfirmedIds, deadLetterIds, conflictOutcomes } =
      classifyUnconfirmedOperations({
        unconfirmedIds,
        pendingOps,
        appliedOperations: applied_operations,
        bridgeTokensByAnimeId,
        now: Date.now(),
      });

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
    await withLocalWrite(rawDb, (writeDb) =>
      applyReconcileResponseWrites(writeDb, {
        applyMode,
        normalizedChanges,
        confirmedAnimeTokens,
        conflictOutcomes,
        deadLetterIds,
        confirmedIds,
        remainingUnconfirmedIds,
        lastChangelogId,
        nextLastChangelogId,
        bridgeConfigId: config.id,
      }),
    );

    return {
      syncedCount: confirmedIds.length,
      backlogReadCount: pendingOps.length,
      hasMorePending:
        unconfirmedIds.length > 0 || totalBacklogRowCount > pendingOps.length,
    };
  } catch (error) {
    await revertPendingOperationsOnFailure(rawDb, pendingOps, error);
    throw error;
  }
}
