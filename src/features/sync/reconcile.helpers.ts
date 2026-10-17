import type { SQLiteDatabase } from 'expo-sqlite';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import { getLastChangelogId } from './last-changelog.helpers';
import { countOperationLogBacklogRows } from './operation-log-retention.helpers';
import { JS_OUTBOX_CLAIM_OWNER, OUTBOX_CHAIN_BUDGET_MS } from './outbox-claim.constants';
import { claimOperationLogBatch } from './outbox-claim.helpers';
import { SEASON_RATING_OPERATION } from './outbox-operation.constants';
import { sendReconcileRound } from './reconcile-round.helpers';
import { RECONCILE_BACKLOG_BATCH_LIMIT } from './reconcile.constants';
import type {
  ReconcileRoundContext,
  ReconcileTelemetryContext,
  SplitRoundOutcome,
  SyncPendingOperationsResult,
} from './reconcile.types';
import { releaseHeldRows, sendSeasonRatingRound } from './season-rating-round.helpers';
import {
  captureSyncDiagnosticsEnvelope,
  flushSyncDiagnosticsOutbox,
} from './sync-diagnostics-flush.helpers';
import {
  buildSyncCycleTelemetry,
  resolveClientTelemetry,
} from './sync-telemetry.helpers';

/**
 * Runs ONE claim and the chain of reconcile rounds it leads to (ADR 009 R-14): the first round
 * sends the oldest row of every claimed key, and each later round sends the next row of the keys
 * the previous round confirmed, until a key is rejected, a round fails, or the chain budget runs
 * out. It reads a bounded backlog of pending rows, confirms only evidenced operations, reapplies
 * bridge changes, and advances the changelog cursor without regressing it.
 *
 * Only the JS dispatcher calls it (`runCoordinatedForegroundSyncCycle`, through `requestFlush`),
 * which is single-flight per database (ADR 009 R-2), so two passes never overlap here.
 *
 * The backlog is claimed as `processing` BEFORE the request and released in the catch, which is
 * what keeps a crash from being indistinguishable from success: every row is either confirmed,
 * requeued, or dead-lettered by the time this returns or throws. Nothing is left claimed by a
 * cycle that is no longer running.
 */
export async function syncPendingOperations(
  rawDb: SQLiteDatabase,
  telemetryContext?: ReconcileTelemetryContext,
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
  const { claim, rows: claimedOps } = await claimOperationLogBatch(rawDb, {
    owner: JS_OUTBOX_CLAIM_OWNER,
    limit: RECONCILE_BACKLOG_BATCH_LIMIT,
  });

  // Reported-value only (design.md Decision 9): under `dedupeBy: 'anime_id'`, the batch counts
  // distinct animes, not rows queued, so it alone cannot tell whether more rows are waiting
  // behind the ones this batch suppressed. This total is read once per cycle purely so
  // `hasMorePending` stays truthful.
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
  // from the `catch` below: that `catch` releases the claimed rows, which would otherwise
  // requeue the user's own pending mutations over a diagnostics POST.
  captureSyncDiagnosticsEnvelope(clientTelemetry);
  // The SAME `config` row this cycle already read, so ONE read gates capture AND drain.
  const diagnosticsFlush = await flushSyncDiagnosticsOutbox({ connection, config });

  const chainDeadline = claim.claimedAt + OUTBOX_CHAIN_BUDGET_MS;
  let round: readonly OperationLogRow[] = claimedOps;
  let roundContext: ReconcileRoundContext = {
    connection,
    deviceId: config.deviceId ?? undefined,
    bridgeConfigId: config.id,
    lastChangelogId,
    clientTelemetry,
    claim,
    chainDeadline,
  };
  let syncedCount = 0;
  let backlogReadCount = 0;
  let unconfirmedCount = 0;
  let shouldRefreshActiveSeason = false;
  let firstRound = true;

  // Every row this cycle claims -- the batch and each successor a reconcile or a rating claims --
  // so a failure releases all of them still held: none stays `processing` once the cycle ends.
  const claimedIds = new Set(claimedOps.map((row) => row.id));

  // The first round always reconciles, even with no edit: it is also this cycle's pull. Every
  // later round is a chain step and carries only the successors the previous round claimed
  // (ADR 009 R-14).
  try {
    do {
      // Sequential by definition: each send waits for the previous confirmation and its token.
      const outcome = await sendSplitRound(rawDb, roundContext, round, firstRound, claimedIds);

      syncedCount += outcome.confirmedCount;
      backlogReadCount += outcome.sentCount;
      unconfirmedCount += outcome.unconfirmedCount;
      shouldRefreshActiveSeason ||= outcome.shouldRefreshActiveSeason;
      round = outcome.successors;
      roundContext = {
        ...roundContext,
        lastChangelogId: outcome.nextLastChangelogId,
        clientTelemetry: null,
      };
      firstRound = false;
    } while (round.length > 0);
  } catch (error) {
    // A failed reconcile already gave its own rows their fate; whatever this claim still holds --
    // the round's ratings, successors an earlier delivery claimed -- goes back unsent.
    await releaseHeldRows(rawDb, [...claimedIds], claim);
    throw error;
  }

  return {
    syncedCount,
    backlogReadCount,
    hasMorePending: unconfirmedCount > 0 || totalBacklogRowCount > backlogReadCount,
    shouldRefreshActiveSeason,
    diagnosticsFlush,
  };
}

/**
 * Sends one round of a chain (ADR 009 R-14, L28). Each key holds one row per round, so a key's
 * rows still go in queue order across both endpoints: its `update` rows share one reconcile, sent
 * on the first round even with no edit (it is the cycle's pull) and on a later round only when it
 * holds an edit; then its season ratings go one per request. A failed reconcile throws before any
 * rating is sent, and the caller releases them. A refused rating is unresolved, not pending: only
 * a retryable rating answer counts as unconfirmed. Every successor either endpoint claims is added
 * to `claimedIds` as soon as it is claimed.
 */
async function sendSplitRound(
  rawDb: SQLiteDatabase,
  context: ReconcileRoundContext,
  round: readonly OperationLogRow[],
  firstRound: boolean,
  claimedIds: Set<number>,
): Promise<SplitRoundOutcome> {
  const ratings = round.filter((row) => row.operation === SEASON_RATING_OPERATION);
  const edits = round.filter((row) => row.operation !== SEASON_RATING_OPERATION);
  const onClaimed = (rows: readonly OperationLogRow[]) => rows.forEach((row) => claimedIds.add(row.id));
  const applied = firstRound || edits.length > 0
    ? await sendReconcileRound(rawDb, context, edits)
    : { sentCount: 0, confirmedCount: 0, unconfirmedCount: 0, nextLastChangelogId: context.lastChangelogId, successors: [] };
  onClaimed(applied.successors);
  const rated = await sendSeasonRatingRound(rawDb, { ...context, onClaimed }, ratings);

  return {
    sentCount: applied.sentCount + rated.attemptedCount,
    confirmedCount: applied.confirmedCount + rated.confirmedCount,
    unconfirmedCount: applied.unconfirmedCount + rated.pendingCount,
    nextLastChangelogId: applied.nextLastChangelogId,
    successors: [...applied.successors, ...rated.successors],
    shouldRefreshActiveSeason: rated.shouldRefreshActiveSeason,
  };
}
