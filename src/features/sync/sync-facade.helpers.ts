import type { SQLiteDatabase } from 'expo-sqlite';
import { inArray } from 'drizzle-orm';
import { createDrizzleDb } from '../../infrastructure/db/client/client.helpers';
import { operationLog, seasonRatingQueue } from '../../infrastructure/db/schema';
import { COVER_SWEEP_TRIGGER_SOURCES } from './cover-sweep/cover-sweep.constants';
import { runCoverSweep } from './cover-sweep/cover-sweep.helpers';
import { syncPendingOperations } from './reconcile.helpers';
import { PENDING_OPERATIONS_LIVE_QUERY_LIMIT } from './reconcile.constants';
import { drainSeasonRatingQueue } from './season-rating-queue.helpers';
import { fetchActiveSeasonFromBridge } from './season-sync.helpers';
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

/**
 * Starts a cover sweep once a foreground sync cycle's own attempt has settled -- success, the
 * `hasMorePending` early return, or failure -- for a trigger source in `COVER_SWEEP_TRIGGER_SOURCES`.
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
function triggerCoverSweepForSource(rawDb: SQLiteDatabase, source: SyncRuntimeTriggerSource): void {
  if (!COVER_SWEEP_TRIGGER_SOURCES.has(source)) {
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
 * Reconcile alone is not success: season-rating delivery and telemetry must complete first.
 */
export async function runCoordinatedForegroundSyncCycle({
  rawDb,
  source,
  setActiveSeasonSnapshot,
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
    const seasonDrainResult = await drainSeasonRatingQueue(rawDb);

    if (seasonDrainResult.failure) {
      throw seasonDrainResult.failure;
    }

    if (seasonDrainResult.shouldRefreshActiveSeason) {
      setActiveSeasonSnapshot(await fetchActiveSeasonFromBridge(rawDb));
    }

    if (result.hasMorePending) {
      markSyncConnectionPending(attempt);
      triggerCoverSweepForSource(rawDb, source);
      return result.syncedCount;
    }

    const syncedAt = Date.now();
    await publishSyncConnectionAttempt({
      attempt,
      persistTelemetry: () =>
        recordSyncAttemptSucceeded(rawDb, source, syncedAt, result.syncedCount),
      publishConnection: () => markSyncConnectionSucceeded(attempt, syncedAt),
    });

    triggerCoverSweepForSource(rawDb, source);
    return result.syncedCount;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('Sync failed');

    triggerCoverSweepForSource(rawDb, source);
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
 * Builds the live query for every durable season-rating row that still requires resolution.
 * Failed rows remain unresolved because they need explicit repair and retry before current truth is safe.
 */
export function buildUnresolvedSeasonRatingQuery(
  rawDb: Parameters<typeof createDrizzleDb>[0],
) {
  return createDrizzleDb(rawDb)
    .select({ id: seasonRatingQueue.id })
    .from(seasonRatingQueue)
    .where(inArray(seasonRatingQueue.status, ['pending', 'syncing', 'failed']))
    .limit(PENDING_OPERATIONS_LIVE_QUERY_LIMIT);
}
