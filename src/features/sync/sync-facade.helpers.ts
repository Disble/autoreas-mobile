import { inArray } from 'drizzle-orm';
import { createDrizzleDb } from '../../infrastructure/db/client/client.helpers';
import { operationLog, seasonRatingQueue } from '../../infrastructure/db/schema';
import { syncPendingOperations } from './reconcile.helpers';
import { PENDING_OPERATIONS_LIVE_QUERY_LIMIT } from './reconcile.constants';
import { drainSeasonRatingQueue } from './season-rating-queue.helpers';
import { fetchActiveSeasonFromBridge } from './season-sync.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from './sync-runtime-status.helpers';
import {
  beginSyncConnectionAttempt,
  markSyncConnectionFailed,
  markSyncConnectionPending,
  markSyncConnectionSucceeded,
  publishSyncConnectionAttempt,
} from './sync-connection-store/sync-connection-store.helpers';
import type { RunCoordinatedForegroundSyncCycleInput } from './sync-facade.types';

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
      return result.syncedCount;
    }

    const syncedAt = Date.now();
    await publishSyncConnectionAttempt({
      attempt,
      persistTelemetry: () =>
        recordSyncAttemptSucceeded(rawDb, source, syncedAt, result.syncedCount),
      publishConnection: () => markSyncConnectionSucceeded(attempt, syncedAt),
    });

    return result.syncedCount;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('Sync failed');

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
