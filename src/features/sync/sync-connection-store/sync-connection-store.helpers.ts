import { BridgeUnreachableError } from '../../../infrastructure/api';
import {
  FOREGROUND_SYNC_CYCLES,
  INITIAL_SYNC_CONNECTION_SNAPSHOT,
  syncConnectionStore,
  SYNC_CONNECTION_ATTEMPT_STATE,
  SYNC_CONNECTION_PUBLICATION_QUEUE_STATE,
} from './sync-connection-store.constants';
import type {
  SyncConnectionAttemptPublication,
  SyncConnectionSnapshot,
} from './sync-connection-store.types';

/** Returns the latest shared foreground sync connection snapshot. */
export function getSyncConnectionSnapshot(): SyncConnectionSnapshot {
  return syncConnectionStore.getState();
}

/** Subscribes a consumer to shared foreground sync connection changes. */
export function subscribeSyncConnection(listener: () => void): () => void {
  return syncConnectionStore.subscribe(listener);
}

/** Starts a newer authoritative connection attempt and returns its monotonic generation. */
export function beginSyncConnectionAttempt(): number {
  SYNC_CONNECTION_ATTEMPT_STATE.current += 1;
  syncConnectionStore.setState((current) => ({
    kind: 'syncing',
    lastSyncAt: current.lastSyncAt,
    message: null,
  }));

  return SYNC_CONNECTION_ATTEMPT_STATE.current;
}

/** Publishes that the whole coordinated foreground sync cycle succeeded. */
export function markSyncConnectionSucceeded(attempt: number, syncedAt: number): void {
  if (attempt !== SYNC_CONNECTION_ATTEMPT_STATE.current) {
    return;
  }

  syncConnectionStore.setState({
    kind: 'online',
    lastSyncAt: syncedAt,
    message: null,
  });
}

/** Publishes a transport or reachable sync failure without erasing prior success history. */
export function markSyncConnectionFailed(attempt: number, error: unknown): void {
  if (attempt !== SYNC_CONNECTION_ATTEMPT_STATE.current) {
    return;
  }

  const message = error instanceof Error ? error.message : 'Sync failed';

  syncConnectionStore.setState((current) => ({
    kind: error instanceof BridgeUnreachableError ? 'unreachable' : 'sync_error',
    lastSyncAt: current.lastSyncAt,
    message,
  }));
}

/** Completes the latest attempt as pending/local rather than claiming current bridge truth. */
export function markSyncConnectionPending(attempt: number): void {
  if (attempt !== SYNC_CONNECTION_ATTEMPT_STATE.current) {
    return;
  }

  syncConnectionStore.setState((current) => ({
    kind: 'idle',
    lastSyncAt: current.lastSyncAt,
    message: null,
  }));
}

/** Invalidates online truth because new durable work exists or sync prerequisites disappeared. */
export function invalidateSyncConnectionOnline(): void {
  SYNC_CONNECTION_ATTEMPT_STATE.current += 1;
  syncConnectionStore.setState((current) => ({
    kind: 'idle',
    lastSyncAt: current.lastSyncAt,
    message: null,
  }));
}

/**
 * Serializes persisted telemetry with visible terminal truth for one attempt generation.
 * The double generation check prevents stale work from writing after a newer attempt starts,
 * while the queue ensures a newer terminal diagnostic settles after an older in-flight write.
 */
export function publishSyncConnectionAttempt({
  attempt,
  persistTelemetry,
  publishConnection,
}: SyncConnectionAttemptPublication): Promise<boolean> {
  const publication = SYNC_CONNECTION_PUBLICATION_QUEUE_STATE.current.then(async () => {
    if (attempt !== SYNC_CONNECTION_ATTEMPT_STATE.current) {
      return false;
    }

    await persistTelemetry();

    if (attempt !== SYNC_CONNECTION_ATTEMPT_STATE.current) {
      return false;
    }

    publishConnection();
    return true;
  });

  SYNC_CONNECTION_PUBLICATION_QUEUE_STATE.current = publication.then(
    () => undefined,
    () => undefined,
  );

  return publication;
}

/**
 * Runs at most one coordinated foreground sync cycle for a database and shares its exact promise.
 * Full-cycle ownership here prevents independent hook instances from publishing overlapping outcomes.
 */
export function runSharedForegroundSyncCycle(
  database: object,
  createCycle: () => Promise<number>,
): Promise<number> {
  const activeCycle = FOREGROUND_SYNC_CYCLES.get(database);

  if (activeCycle) {
    return activeCycle;
  }

  const cycle = createCycle();
  const trackedCycle = cycle.finally(() => {
    if (FOREGROUND_SYNC_CYCLES.get(database) === trackedCycle) {
      FOREGROUND_SYNC_CYCLES.delete(database);
    }
  });

  FOREGROUND_SYNC_CYCLES.set(database, trackedCycle);
  return trackedCycle;
}

/** Resets module state so tests cannot leak connection truth between cases. */
export function resetSyncConnectionStore(): void {
  FOREGROUND_SYNC_CYCLES.clear();
  SYNC_CONNECTION_ATTEMPT_STATE.current = 0;
  SYNC_CONNECTION_PUBLICATION_QUEUE_STATE.current = Promise.resolve();
  syncConnectionStore.setState(INITIAL_SYNC_CONNECTION_SNAPSHOT, true);
}
