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
 * - 2xx: delivered, remove and continue.
 * - 400/413/422 (THIS envelope is malformed): remove and continue.
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

  try {
    const candidates = store.readFlushCandidates(SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE, now());

    for (const candidate of candidates) {
      attempted += 1;

      let result;
      try {
        result = await client.postSyncDiagnostics(
          params.connection,
          JSON.parse(candidate.payload) as unknown,
          { timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS },
        );
      } catch {
        break; // transport throw: the link or the bridge is down, stop the batch
      }

      if (result.ok) {
        store.remove(candidate.cycleId);
        delivered += 1;
        continue;
      }

      if (isEnvelopeRejection(result.status)) {
        store.remove(candidate.cycleId);
        continue;
      }

      if (result.retryAfterMs !== null) {
        store.deferUntil(now() + result.retryAfterMs);
      }

      break; // transient failure: stop, the next rows would fail identically
    }
  } catch {
    // Swallowed by contract (Decision 5): instrumentation delivery must never fail the cycle.
  }

  return { attempted, delivered };
}
