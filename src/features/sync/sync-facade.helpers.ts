import type { SQLiteDatabase } from 'expo-sqlite';
import { and, eq, inArray, not } from 'drizzle-orm';
import { createDrizzleDb } from '../../infrastructure/db/client/client.helpers';
import { operationLog, seasonRatingQueue } from '../../infrastructure/db/schema';
import { useActiveSeasonStore } from '../../infrastructure/store/active-season-store';
import { COVER_SWEEP_TRIGGER_SOURCES } from './cover-sweep/cover-sweep.constants';
import { runCoverSweep } from './cover-sweep/cover-sweep.helpers';
import { syncPendingOperations } from './reconcile.helpers';
import { PENDING_OPERATIONS_LIVE_QUERY_LIMIT } from './reconcile.constants';
import { drainSeasonRatingQueue } from './season-rating-queue.helpers';
import { refreshActiveSeasonSnapshot } from './active-season-refresh.helpers';
import { healSnapshotOnDemand } from './snapshot-heal.helpers';
import type { SnapshotHealDemand } from './snapshot-heal.types';
import { UNRESOLVED_RATING_FAILURE_KINDS } from './unresolved-key.constants';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from './sync-runtime-status.helpers';
import type { SyncRuntimeTriggerSource } from './sync-runtime-status.types';
import {
  beginSyncConnectionAttempt,
  markSyncConnectionFailed,
  markSyncConnectionPending,
  markSyncConnectionSucceeded,
  publishSyncConnectionAttempt,
} from './sync-connection-store/sync-connection-store.helpers';
import type {
  ResolveSyncPrerequisitesInput,
  RunCoordinatedForegroundSyncCycleInput,
  SyncPrerequisiteVerdict,
} from './sync-facade.types';
import type { SyncFlushRequest } from './sync-flush.types';

/**
 * Starts a cover sweep once a foreground sync cycle's own attempt has settled -- success, the
 * `hasMorePending` early return, or failure -- for a trigger source in `COVER_SWEEP_TRIGGER_SOURCES`,
 * or for a cycle that always heals the snapshot (mount and resume), whose sweep runs after the heal
 * so newly healed rows get their covers.
 * Never awaited: image downloads must never hold the caller's returned promise (the manual refresh
 * spinner included).
 *
 * A `manual` pull forces every active cover to revalidate (`runCoverSweep`'s `force` option): the
 * bridge answers an unchanged cover with a cheap 304, so the user's own pull-to-refresh always
 * checks for a cover replaced at the same source path instead of waiting out its
 * `nextAttemptAt`. `ws_sync_required` and `network_regained` stay unforced, honoring the normal TTL.
 * `runCoverSweep` is single-flight for an unforced call, so this safely joins an already-running
 * unforced sweep instead of starting a second one; a forced call never joins one running unforced
 * (see `runCoverSweep`'s own doc comment).
 */
function triggerCoverSweep(
  rawDb: SQLiteDatabase,
  source: SyncRuntimeTriggerSource,
  healSnapshot: SnapshotHealDemand,
): void {
  if (!COVER_SWEEP_TRIGGER_SOURCES.has(source) && healSnapshot !== 'always') {
    return;
  }

  void runCoverSweep(rawDb, undefined, { force: source === 'manual' }).catch((error: unknown) => {
    console.warn('[useSyncFacade] Cover sweep failed', error);
  });
}

/**
 * Resolves whether this facade may sync, must publish local mode, or knows nothing yet.
 * The `unknown` verdict is the whole point: a bridge-config query that has not answered is not
 * evidence of an unpaired bridge, and publishing it as one erased the shared online status on
 * every mount. An unanswerable config is different -- it never resolves, so waiting on it would
 * keep a stale online claim alive for the rest of the session.
 */
export function resolveSyncPrerequisites({
  hasDatabase,
  configStatus,
  isConfigured,
}: ResolveSyncPrerequisitesInput): SyncPrerequisiteVerdict {
  if (!hasDatabase || configStatus === 'unavailable') {
    return 'missing';
  }

  if (configStatus === 'pending') {
    return 'unknown';
  }

  return isConfigured ? 'ready' : 'missing';
}

/**
 * Persists failure telemetry without allowing an observability write to replace the original sync error.
 * Connection truth must still be published when the diagnostics row cannot be updated.
 */
async function persistSyncFailureTelemetrySafely(
  persistFailure: () => Promise<void>,
): Promise<void> {
  try {
    await persistFailure();
  } catch (error) {
    console.warn('[useSyncFacade] Failed to persist sync failure telemetry', error);
  }
}

/**
 * Runs every step owned by one foreground sync cycle and publishes exactly one terminal outcome.
 * Reconcile alone is not success: a season rating still queued for retry keeps the cycle pending,
 * and telemetry must complete first. A failing rating never fails the cycle (ADR 009 R-5).
 *
 * This cycle is the JS dispatcher (ADR 009 R-2) and the one place its outbound kinds are listed,
 * in send order: anime operations (`syncPendingOperations`, whose pass also carries the
 * diagnostics outbox), then season ratings (`drainSeasonRatingQueue`). Callers never run it
 * directly; they enqueue and call `requestFlush`, which runs it through
 * `dispatchForegroundSyncFlush`. The active season is refreshed after a delivered rating, or when
 * the request demands it (the WebSocket season events, I8); that refresh is best effort and never
 * fails the cycle. The full-snapshot heal runs last, when the request demands it (ADR 009 R-7):
 * always on mount and resume, on a reconnect only when the last successful heal is stale. It is
 * best effort too, and it runs even when the sends failed, before the failure is published.
 *
 * The reconciled cycle's own diagnostics flush counters ride the attempt-succeeded write this path
 * already performs: `recordSyncAttemptSucceeded` takes the flush result as an optional argument, so
 * the destruction and reap counters cost ZERO extra status transactions here. That is the reason the
 * headless cycle's `recordBacklogReadCount` call is NOT mirrored into this path -- mirroring it
 * would add one status write per foreground cycle and would also pull the whole operation-log
 * convergence projection and the outbox failed-write count into a path that reads neither (they are
 * `recordBacklogReadCount`'s other inputs), widening what THIS runtime reports far beyond the
 * counters that were being dropped.
 *
 * Deliberate consequence of folding: the counters are written only where this path writes status at
 * all. A cycle that returns early on `hasMorePending` -- and one that throws after reconcile, since
 * the failure write carries no flush evidence -- leaves the columns at the previous cycle's
 * measurement rather than reporting a fresh one. Neither path fabricates a zero (design.md
 * Decision 7), and both are pinned by tests so adding a write there is a conscious contract change.
 */
export async function runCoordinatedForegroundSyncCycle({
  rawDb,
  source,
  setActiveSeasonSnapshot,
  refreshActiveSeason = false,
  healSnapshot = 'never',
}: RunCoordinatedForegroundSyncCycleInput): Promise<number> {
  const attempt = beginSyncConnectionAttempt();

  try {
    const attemptedAt = Date.now();
    await publishSyncConnectionAttempt({
      attempt,
      persistTelemetry: () => recordSyncAttemptStarted(rawDb, source, attemptedAt),
      publishConnection: () => undefined,
    });
    const result = await syncPendingOperations(rawDb);
    // A failing rating never fails the cycle (ADR 009 R-5, I4): a terminal one is kept as
    // unresolved, and one left queued for retry only keeps the cycle pending, like an anime row.
    const seasonDrainResult = await drainSeasonRatingQueue(rawDb);

    if (refreshActiveSeason || seasonDrainResult.shouldRefreshActiveSeason) {
      await refreshActiveSeasonSnapshot(rawDb, setActiveSeasonSnapshot);
    }

    await healSnapshotOnDemand(rawDb, healSnapshot);

    if (result.hasMorePending || seasonDrainResult.hasMorePending) {
      markSyncConnectionPending(attempt);
      triggerCoverSweep(rawDb, source, healSnapshot);
      return result.syncedCount;
    }

    const syncedAt = Date.now();

    // `result.diagnosticsFlush` is the only place a destruction is visible on the foreground path:
    // when the native engine owns background, this cycle is the one performing the discarding.
    await publishSyncConnectionAttempt({
      attempt,
      persistTelemetry: () =>
        recordSyncAttemptSucceeded(
          rawDb,
          source,
          syncedAt,
          result.syncedCount,
          null,
          result.diagnosticsFlush,
        ),
      publishConnection: () => markSyncConnectionSucceeded(attempt, syncedAt),
    });

    triggerCoverSweep(rawDb, source, healSnapshot);
    return result.syncedCount;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('Sync failed');

    // The heal demand is served even when the sends failed (ADR 009 R-7): the snapshot is a
    // separate read, rows that failed stay unconfirmed so the heal skips them, and it never throws.
    await healSnapshotOnDemand(rawDb, healSnapshot);
    triggerCoverSweep(rawDb, source, healSnapshot);
    await publishSyncConnectionAttempt({
      attempt,
      persistTelemetry: () =>
        persistSyncFailureTelemetrySafely(() =>
          recordSyncAttemptFailed(rawDb, source, Date.now(), failure.message),
        ),
      publishConnection: () => markSyncConnectionFailed(attempt, failure),
    });
    throw failure;
  }
}

/**
 * The JS dispatcher the foreground runtime registers with `registerSyncFlushDispatcher`: one
 * flush request becomes one coordinated cycle, publishing season truth to the shared store.
 */
export function dispatchForegroundSyncFlush(request: SyncFlushRequest): Promise<number> {
  return runCoordinatedForegroundSyncCycle({
    rawDb: request.database,
    source: request.source,
    refreshActiveSeason: request.refreshActiveSeason,
    healSnapshot: request.healSnapshot,
    setActiveSeasonSnapshot: useActiveSeasonStore.getState().setActiveSeasonSnapshot,
  });
}

/**
 * Builds the live query used to count pending outbox operations.
 * The facade exposes this count so the UI can reflect offline-first sync backlog without touching SQL.
 */
export function buildPendingOperationsQuery(rawDb: Parameters<typeof createDrizzleDb>[0]) {
  return createDrizzleDb(rawDb)
    .select({ id: operationLog.id })
    .from(operationLog)
    .where(inArray(operationLog.status, ['pending', 'processing']))
    .limit(PENDING_OPERATIONS_LIVE_QUERY_LIMIT);
}

/**
 * Builds the live query for every durable season-rating row that is still pending work.
 * Every `pending` or `syncing` row counts; an unresolved rating
 * (`failed` with a failure kind in `UNRESOLVED_RATING_FAILURE_KINDS`, ADR 009 R-16b) is never
 * sent again, so it is excluded with the same predicate `readSeasonRatingQueueBacklog` uses.
 */
export function buildUnresolvedSeasonRatingQuery(
  rawDb: Parameters<typeof createDrizzleDb>[0],
) {
  return createDrizzleDb(rawDb)
    .select({ id: seasonRatingQueue.id })
    .from(seasonRatingQueue)
    .where(
      and(
        inArray(seasonRatingQueue.status, ['pending', 'syncing', 'failed']),
        not(
          and(
            eq(seasonRatingQueue.status, 'failed'),
            inArray(seasonRatingQueue.lastFailureKind, [...UNRESOLVED_RATING_FAILURE_KINDS]),
          )!,
        ),
      ),
    )
    .limit(PENDING_OPERATIONS_LIVE_QUERY_LIMIT);
}
