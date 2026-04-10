import { eq } from 'drizzle-orm';
import { createDrizzleDb } from '../../infrastructure/db/client';
import { animes, operationLog } from '../../infrastructure/db/schema';
import { syncPendingOperations } from './reconcile.helpers';
import { initialSync } from './use-initial-sync';
import type {
  SyncBootstrapMode,
  SyncBootstrapStrategy,
  SyncEvent,
  SyncState,
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
  return syncPendingOperations(rawDb);
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
 * Advances the explicit sync state machine from a domain event.
 * Using a pure transition function keeps runtime status changes predictable and testable.
 */
export function transitionSyncState(currentState: SyncState, event: SyncEvent): SyncState {
  switch (event.type) {
    case 'MARK_OFFLINE':
      return { kind: 'offline' };
    case 'SYNC_STARTED':
      return { kind: 'syncing' };
    case 'SYNC_SUCCEEDED':
      return { kind: 'online', lastSyncAt: event.syncedAt };
    case 'SYNC_FAILED':
      return { kind: 'error', message: event.message };
    default:
      return currentState;
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
    .where(eq(operationLog.status, 'pending'));
}
