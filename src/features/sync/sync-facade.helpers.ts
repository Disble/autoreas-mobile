import { inArray } from 'drizzle-orm';
import { createDrizzleDb } from '../../infrastructure/db/client/client.helpers';
import { animes, operationLog, seasonRatingQueue } from '../../infrastructure/db/schema';
import { syncPendingOperations } from './reconcile.helpers';
import { PENDING_OPERATIONS_LIVE_QUERY_LIMIT } from './reconcile.constants';
import { initialSync } from './use-initial-sync';
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
import type {
  RunCoordinatedForegroundSyncCycleInput,
  SyncBootstrapMode,
  SyncBootstrapStrategy,
} from './sync-facade.types';

/**
 * Resolves the bootstrap sync mode from the current local cache state.
 * This is the selector around the Strategy pattern: cache-empty starts with hydration,
 * cache-present starts with reconcile so the app stays local-first on boot.
 */
export function resolveBootstrapMode(hasLocalCache: boolean): SyncBootstrapMode {
  return hasLocalCache ? 'reconcile' : 'hydrate';
}

/**
 * Returns the concrete bootstrap strategy for the selected mode.
 * The hook delegates to this stable contract instead of branching over algorithms inline.
 */
export function resolveBootstrapStrategy(mode: SyncBootstrapMode): SyncBootstrapStrategy {
  return mode === 'hydrate' ? runHydrationBootstrapStrategy : runReconcileBootstrapStrategy;
}

/**
 * Hydrates the local cache from the bridge when the device is paired but no local anime rows exist yet.
 * This keeps first-time post-pairing startup compatible with offline-first after the cache is seeded.
 */
export async function runHydrationBootstrapStrategy({
  rawDb,
}: Parameters<SyncBootstrapStrategy>[0]): Promise<number> {
  return initialSync(rawDb);
}

/**
 * Reconciles pending local changes against the bridge when local cache already exists.
 * This preserves local-first rendering by syncing in background instead of re-downloading everything.
 */
export async function runReconcileBootstrapStrategy({
  rawDb,
}: Parameters<SyncBootstrapStrategy>[0]): Promise<number> {
  const result = await syncPendingOperations(rawDb);

  return result.syncedCount;
}

/**
 * Adapts an async sync callback to the void callback contract expected by the WebSocket hook.
 * The adapter translates `() => Promise<number>` into `() => void` while preserving error handling.
 */
export function adaptAsyncSyncToVoidHandler(
  syncAction: () => Promise<number>,
  handleError: (error: unknown) => void,
): () => void {
  return () => {
    void syncAction().catch(handleError);
  };
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
 * Builds the live query used to detect whether the local anime cache already contains rows.
 * The bootstrap strategy depends on this because empty-cache startup needs hydration instead of reconcile.
 */
export function buildLocalAnimePresenceQuery(rawDb: Parameters<typeof createDrizzleDb>[0]) {
  return createDrizzleDb(rawDb).select({ id: animes._id }).from(animes).limit(1);
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
