import type { SyncConnectionSnapshot } from './sync-connection-store/sync-connection-store.types';
import type { SyncFacadeConnectionStatus, SyncRuntimeReachabilityEvidence } from './bridge-reachability.types';

/**
 * Returns the instant of the row's latest success, only when that success is also the row's latest
 * attempt: a later failed attempt, from either runtime, means the success is no longer the newest
 * exchange.
 */
function readLatestRuntimeSuccess(evidence: SyncRuntimeReachabilityEvidence | null): number | null {
  if (!evidence || evidence.lastSuccessAt === null) {
    return null;
  }

  return evidence.lastSuccessAt >= (evidence.lastAttemptAt ?? 0) ? evidence.lastSuccessAt : null;
}

/**
 * Resolves the status the facade exposes from evidence the app already holds, never from a probe
 * (ADR 009 R-9). A running, online or rejected sync passes through. Otherwise (`idle` or
 * `unreachable`), the bridge counts as reachable when the latest exchange reached it: the JS
 * store's own evidence, overridden by a newer success in `sync_runtime_status`, which the native
 * engine also writes. With no JS evidence yet the row is not trusted, so a success left from an
 * earlier session or pairing never claims a bridge nobody has reached since.
 */
export function resolveSyncFacadeConnectionStatus(
  snapshot: SyncConnectionSnapshot,
  runtimeEvidence: SyncRuntimeReachabilityEvidence | null,
): SyncFacadeConnectionStatus {
  const { bridgeContact, kind } = snapshot;

  if ((kind !== 'idle' && kind !== 'unreachable') || bridgeContact === null) {
    return kind;
  }

  const runtimeSuccessAt = readLatestRuntimeSuccess(runtimeEvidence);
  const isReached = runtimeSuccessAt !== null && runtimeSuccessAt > bridgeContact.at
    ? true
    : bridgeContact.reached;

  return isReached ? 'reachable' : kind;
}
