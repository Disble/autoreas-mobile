import { BridgeUnreachableError } from '../../../infrastructure/api';
import {
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
    ...current,
    kind: 'syncing',
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
    bridgeContact: { at: syncedAt, reached: true },
  });
}

/**
 * Publishes a transport or reachable sync failure without erasing prior success history.
 * Only a transport failure is evidence that the bridge was not reached (ADR 009 R-9); any other
 * failure keeps the previous reachability evidence, because it does not prove either way.
 */
export function markSyncConnectionFailed(attempt: number, error: unknown): void {
  if (attempt !== SYNC_CONNECTION_ATTEMPT_STATE.current) {
    return;
  }

  const message = error instanceof Error ? error.message : 'Sync failed';
  const isUnreachable = error instanceof BridgeUnreachableError;

  syncConnectionStore.setState((current) => ({
    kind: isUnreachable ? 'unreachable' : 'sync_error',
    lastSyncAt: current.lastSyncAt,
    message,
    bridgeContact: isUnreachable ? { at: Date.now(), reached: false } : current.bridgeContact,
  }));
}

/**
 * Completes the latest attempt as pending/local rather than claiming current bridge truth. The
 * attempt did reach the bridge at `reachedAt` (its reconcile was answered), so that is recorded as
 * reachability evidence even though work remains (ADR 009 R-9).
 */
export function markSyncConnectionPending(attempt: number, reachedAt: number): void {
  if (attempt !== SYNC_CONNECTION_ATTEMPT_STATE.current) {
    return;
  }

  syncConnectionStore.setState((current) => ({
    kind: 'idle',
    lastSyncAt: current.lastSyncAt,
    message: null,
    bridgeContact: { at: reachedAt, reached: true },
  }));
}

/**
 * Invalidates online truth because new durable work exists. New work says nothing about the
 * bridge, so the reachability evidence is kept.
 */
export function invalidateSyncConnectionOnline(): void {
  SYNC_CONNECTION_ATTEMPT_STATE.current += 1;
  syncConnectionStore.setState((current) => ({
    ...current,
    kind: 'idle',
    message: null,
  }));
}

/**
 * Invalidates online truth because the sync prerequisites disappeared (unpaired, no database),
 * and forgets the reachability evidence: it belonged to a pairing that no longer exists.
 */
export function forgetSyncConnectionBridge(): void {
  SYNC_CONNECTION_ATTEMPT_STATE.current += 1;
  syncConnectionStore.setState((current) => ({
    ...current,
    kind: 'idle',
    message: null,
    bridgeContact: null,
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

/** Resets module state so tests cannot leak connection truth between cases. */
export function resetSyncConnectionStore(): void {
  SYNC_CONNECTION_ATTEMPT_STATE.current = 0;
  SYNC_CONNECTION_PUBLICATION_QUEUE_STATE.current = Promise.resolve();
  syncConnectionStore.setState(INITIAL_SYNC_CONNECTION_SNAPSHOT, true);
}
