import type { SQLiteDatabase } from 'expo-sqlite';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import { getLastChangelogId } from './last-changelog.helpers';
import { countOperationLogBacklogRows } from './operation-log-retention.helpers';
import { JS_OUTBOX_CLAIM_OWNER, OUTBOX_CHAIN_BUDGET_MS } from './outbox-claim.constants';
import { claimOperationLogBatch } from './outbox-claim.helpers';
import { publishCheckpoint, sendReconcileRound } from './reconcile-round.helpers';
import {
  RECONCILE_BACKLOG_BATCH_LIMIT,
  syncStateByDatabase,
} from './reconcile.constants';
import type {
  ReconcileApplyMode,
  ReconcileRoundContext,
  ReconcileTelemetryContext,
  SyncCycleCheckpointRecorder,
  SyncPendingOperationsResult,
} from './reconcile.types';
import {
  captureSyncDiagnosticsEnvelope,
  flushSyncDiagnosticsOutbox,
} from './sync-diagnostics-flush.helpers';
import type { SyncDiagnosticsFlushResult } from './sync-diagnostics-flush.types';
import {
  buildSyncCycleTelemetry,
  resolveClientTelemetry,
} from './sync-telemetry.helpers';

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
 *
 * `checkpointRecorder` publishes an ENTRY checkpoint per fine-grained stage of the pass --
 * `backlog_read`, `claim_ops`, `http`, `parse_response`, `apply_write` -- per
 * {@link SyncCycleCheckpointRecorder}'s entry/never-throws contract.
 */
export async function syncPendingOperations(
  rawDb: SQLiteDatabase,
  applyMode: ReconcileApplyMode = 'deferred',
  telemetryContext?: ReconcileTelemetryContext,
  checkpointRecorder?: SyncCycleCheckpointRecorder,
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
    // Reruns replace, rather than accumulate, the diagnostics-flush outcome: each batch flushes
    // whatever the outbox holds AT THAT MOMENT, and the caller cares about the most recent state.
    let diagnosticsFlush: SyncDiagnosticsFlushResult;

    do {
      syncState.rerunRequested = false;
      const batch = await performSyncPendingOperations(
        rawDb,
        applyMode,
        telemetryContext,
        checkpointRecorder,
      );

      totalConfirmed += batch.syncedCount;
      totalBacklogRead += batch.backlogReadCount;
      hasMorePending = batch.hasMorePending;
      diagnosticsFlush = batch.diagnosticsFlush;
    } while (syncState.rerunRequested);

    return {
      syncedCount: totalConfirmed,
      backlogReadCount: totalBacklogRead,
      hasMorePending,
      diagnosticsFlush,
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
 * Runs ONE claim and the chain of reconcile rounds it leads to (ADR 009 R-14): the first round
 * sends the oldest row of every claimed key, and each later round sends the next row of the keys
 * the previous round confirmed, until a key is rejected, a round fails, or the chain budget runs
 * out. The rerun loop and the in-flight guard belong to `syncPendingOperations`.
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
  checkpointRecorder?: SyncCycleCheckpointRecorder,
): Promise<SyncPendingOperationsResult> {
  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    throw new Error('Bridge config is missing or incomplete');
  }

  // Include 'processing' so operations orphaned by a cycle that died mid-flight (crash, app
  // kill, an earlier transport failure) are recovered once their claim expires: they get
  // re-sent and confirmed instead of staying stuck in 'processing' forever. A stuck 'processing'
  // op is poisonous because `loadPendingOutboxRecordIds` treats it as un-acked local intent and
  // `defer_outbox` then drops EVERY remote change for that anime, freezing it out of sync.
  // `dedupeBy: 'anime_id'` (design.md Decision 9, Requirement 10) caps the batch at one queued
  // operation per anime -- the oldest by `created_at`/`id` -- so `limit` bounds distinct animes.
  // The read and the claim share ONE write door (ADR 009 R-13): a key with a live claim, ours
  // or Kotlin's, is skipped, and the claim cannot be raced between the read and the write.
  // ENTRY semantics: published BEFORE the step is awaited, so a hang reports THAT step.
  publishCheckpoint(checkpointRecorder, 'backlog_read');
  const { claim, rows: claimedOps } = await claimOperationLogBatch(rawDb, {
    owner: JS_OUTBOX_CLAIM_OWNER,
    limit: RECONCILE_BACKLOG_BATCH_LIMIT,
    onClaim: () => publishCheckpoint(checkpointRecorder, 'claim_ops'),
  });

  // Reported-value only (design.md Decision 9): under `dedupeBy: 'anime_id'`, the batch counts
  // distinct animes, not rows queued, so it alone cannot tell whether more rows are waiting
  // behind the ones this batch suppressed. This total is read once per cycle purely so
  // `hasMorePending` stays truthful; it never drives the rerun loop.
  const totalBacklogRowCount = claimedOps.length > 0
    ? await countOperationLogBacklogRows(rawDb, ['pending', 'processing'])
    : 0;

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
          pendingOpsCount: claimedOps.length,
          cursor: lastChangelogId,
          now: Date.now(),
          recentEvents: telemetryContext.recentEvents,
        }),
        config,
      )
    : null;
  // Both calls sit here, lexically BEFORE the `try` below and outside any `withLocalWrite`
  // callback (design.md Decision 5). `captureSyncDiagnosticsEnvelope` is synchronous and
  // swallows by contract; `flushSyncDiagnosticsOutbox` never rejects. Placement, not the
  // never-rejecting contract alone, is what makes a diagnostics-delivery failure unreachable
  // from the `catch` below: that `catch` calls `revertPendingOperationsOnFailure`, which would
  // otherwise dead-letter or requeue the user's own pending mutations over a diagnostics POST.
  captureSyncDiagnosticsEnvelope(clientTelemetry);
  // The SAME `config` row this cycle already read, so ONE read gates capture AND drain.
  const diagnosticsFlush = await flushSyncDiagnosticsOutbox({ connection, config });

  const chainDeadline = claim.claimedAt + OUTBOX_CHAIN_BUDGET_MS;
  let round: readonly OperationLogRow[] = claimedOps;
  let roundContext: ReconcileRoundContext = {
    applyMode,
    connection,
    deviceId: config.deviceId ?? undefined,
    bridgeConfigId: config.id,
    lastChangelogId,
    clientTelemetry,
    claim,
    chainDeadline,
    checkpointRecorder,
  };
  let syncedCount = 0;
  let backlogReadCount = 0;
  let unconfirmedCount = 0;

  // The first round always goes out, even empty: it is also this cycle's pull. Every later round
  // is a chain step and carries only the successors the previous round claimed (ADR 009 R-14).
  do {
    // Sequential by definition: each send waits for the previous confirmation and its token.
    const outcome = await sendReconcileRound(rawDb, roundContext, round);

    syncedCount += outcome.confirmedCount;
    backlogReadCount += outcome.sentCount;
    unconfirmedCount += outcome.unconfirmedCount;
    round = outcome.successors;
    roundContext = {
      ...roundContext,
      lastChangelogId: outcome.nextLastChangelogId,
      clientTelemetry: null,
    };
  } while (round.length > 0);

  return {
    syncedCount,
    backlogReadCount,
    hasMorePending: unconfirmedCount > 0 || totalBacklogRowCount > backlogReadCount,
    diagnosticsFlush,
  };
}
