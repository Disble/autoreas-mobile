import { bridgeClient } from '../../infrastructure/api';
import { syncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import {
  SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE,
  SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
} from './sync-diagnostics-flush.constants';
import type {
  CaptureSyncDiagnosticsEnvelopeParams,
  FlushSyncDiagnosticsOutboxParams,
  SyncDiagnosticsFlushResult,
} from './sync-diagnostics-flush.types';
import type { WireSyncCycleTelemetry } from './sync-telemetry.types';
import type {
  BridgeClient,
  BridgeConnection,
} from '../../infrastructure/api/bridge-client/bridge-client.types';
import type { SyncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox';

/** One entry as `readFlushCandidates` hands it back, derived so no extra import is needed. */
type FlushCandidate = ReturnType<SyncDiagnosticsOutboxStore['readFlushCandidates']>[number];

/** What one envelope's round trip did, flattened so the flush loop is a tally, not a ladder. */
type EnvelopeDisposition = 'delivered' | 'failed_removal' | 'discarded' | 'stop';

/** Collaborators one envelope's disposition needs, already resolved from their defaults. */
interface DisposeOfEnvelopeParams {
  readonly store: SyncDiagnosticsOutboxStore;
  readonly client: Pick<BridgeClient, 'postSyncDiagnostics'>;
  readonly connection: BridgeConnection;
  readonly now: () => number;
}

/**
 * Resolves one envelope's round trip into a single disposition.
 *
 * Extracted from `flushSyncDiagnosticsOutbox` so the loop stays a flat tally instead of a nested
 * branch ladder. The taxonomy is unchanged and so is the swallow contract: this function still
 * never throws for a transport failure, it reports `'stop'` and lets the caller end the batch.
 */
async function disposeOfEnvelope(
  params: DisposeOfEnvelopeParams,
  candidate: FlushCandidate,
): Promise<EnvelopeDisposition> {
  let result;
  try {
    result = await params.client.postSyncDiagnostics(
      params.connection,
      JSON.parse(candidate.payload) as unknown,
      { timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS },
    );
  } catch {
    return 'stop'; // transport throw: the link or the bridge is down
  }

  if (result.ok) {
    return params.store.remove(candidate.cycleId) === 'removed' ? 'delivered' : 'failed_removal';
  }

  if (isEnvelopeRejection(result.status)) {
    params.store.remove(candidate.cycleId);
    return 'discarded';
  }

  if (result.retryAfterMs !== null) {
    params.store.deferUntil(params.now() + result.retryAfterMs);
  }

  return 'stop';
}

/**
 * THIS envelope is malformed, per Decision 4's narrower taxonomy -- NOT
 * `isPermanentReconcileError`'s blanket `>= 400 && < 500` (`reconcile.helpers.ts:62-64`). Most
 * 4xx (404 before the endpoint ships, 408, 429) condemn nothing about the envelope's content and
 * must stop the batch like a 5xx instead of deleting it: the bridge names the offending field
 * only in this closed set, so it is the only set that will reject the same bytes forever.
 */
function isEnvelopeRejection(status: number): boolean {
  return status === 400 || status === 413 || status === 422;
}

/**
 * Durably captures one cycle's envelope before transmission is attempted (spec: "Capture
 * happens before the request is attempted, not after"). Synchronous and swallows by contract --
 * the store never throws -- because capture must never be the reason a sync cycle fails.
 *
 * Gated only on `clientTelemetry` being non-null: `resolveClientTelemetry` already applies the
 * telemetry preference AND the "was a context supplied" check upstream (reconcile.helpers.ts),
 * so a null here already means "do not capture" -- there is no second gate to re-implement.
 */
export function captureSyncDiagnosticsEnvelope(
  clientTelemetry: WireSyncCycleTelemetry | null,
  params: CaptureSyncDiagnosticsEnvelopeParams = {},
): void {
  if (!clientTelemetry) {
    return;
  }

  const store = params.store ?? syncDiagnosticsOutboxStore;

  store.enqueue({
    cycleId: clientTelemetry.cycle_id,
    payload: JSON.stringify(clientTelemetry),
  });
}

/**
 * Attempts delivery of up to `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE` oldest eligible entries, oldest
 * first -- the same order eviction uses, so the row closest to being destroyed is sent first.
 *
 * NEVER REJECTS (Decision 5): a diagnostics-delivery failure must never be the reason a sync
 * cycle fails. Per-envelope disposition (Decision 4), deliberately narrower than
 * `isPermanentReconcileError`:
 * - 2xx: delivered only if the removal is CONFIRMED (Decision 2/3); an unconfirmed removal
 *   counts as `failedRemovals` instead, since the row is still there for the next cycle to
 *   re-send.
 * - 400/413/422 (THIS envelope is malformed): remove, count as `discarded`, and continue.
 * - every other failure -- 404/408/429/5xx/throw -- leaves the row and STOPS the whole batch,
 *   since the link or the bridge is down and the next rows would fail identically. A parseable
 *   `Retry-After` is persisted as a not-before gate before stopping.
 */
export async function flushSyncDiagnosticsOutbox(
  params: FlushSyncDiagnosticsOutboxParams,
): Promise<SyncDiagnosticsFlushResult> {
  const store = params.store ?? syncDiagnosticsOutboxStore;
  const client = params.client ?? bridgeClient;
  const now = params.now ?? Date.now;

  let attempted = 0;
  let delivered = 0;
  let discarded = 0;
  let failedRemovals = 0;

  try {
    const candidates = store.readFlushCandidates(SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE, now());

    for (const candidate of candidates) {
      attempted += 1;
      const disposition = await disposeOfEnvelope({ store, client, connection: params.connection, now }, candidate);

      if (disposition === 'stop') {
        break;
      }

      if (disposition === 'delivered') {
        delivered += 1;
      } else if (disposition === 'failed_removal') {
        failedRemovals += 1;
      } else {
        discarded += 1;
      }
    }
  } catch {
    // Swallowed by contract (Decision 5): instrumentation delivery must never fail the cycle.
  }

  return { attempted, delivered, discarded, failedRemovals };
}
