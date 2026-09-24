import { bridgeClient } from '../../infrastructure/api';
import { syncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import { isSyncTelemetryEnabled } from './sync-telemetry-preference.helpers';
import {
  SYNC_DIAGNOSTICS_ACCEPTED_KINDS,
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
type EnvelopeDisposition = 'delivered' | 'failed_removal' | 'discarded' | 'skipped' | 'stop';

/** Collaborators one envelope's disposition needs, already resolved from their defaults. */
interface DisposeOfEnvelopeParams {
  readonly store: SyncDiagnosticsOutboxStore;
  readonly client: Pick<BridgeClient, 'postSyncDiagnostics'>;
  readonly connection: BridgeConnection;
  readonly now: () => number;
}

/**
 * True when the bridge currently accepts a stored diagnostics body, judged by the `kind` it declares.
 *
 * A membership test against `SYNC_DIAGNOSTICS_ACCEPTED_KINDS`, reading the body the way the bridge
 * reads it: no `kind` key at all means the kindless legacy cycle envelope (`undefined`), and every
 * other body declares whatever its key holds -- including an explicit `null`, which that registry
 * cannot match. A body that is not an object declares nothing the registry can name, so it is
 * refused rather than guessed at.
 *
 * Exported because the chapter recorder consults the SAME decision before it enqueues: two call
 * sites deciding this separately would be two places to drift, and only one of them can be the
 * source of truth for what the bridge accepts today.
 */
export function isSyncDiagnosticsPayloadAccepted(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }

  return (SYNC_DIAGNOSTICS_ACCEPTED_KINDS as readonly unknown[]).includes(
    (payload as { readonly kind?: unknown }).kind,
  );
}

/**
 * Resolves one envelope's round trip into a single disposition.
 *
 * Extracted from `flushSyncDiagnosticsOutbox` so the loop stays a flat tally instead of a nested
 * branch ladder. The taxonomy is unchanged and so is the swallow contract: this function still
 * never throws for a transport failure, it reports `'stop'` and lets the caller end the batch.
 *
 * The acceptance check runs BEFORE the request, and an unroutable body is reported as `'skipped'`:
 * not posted (the bridge would answer 400 and the row would then be deleted), not removed, and not
 * counted. It must be a skip rather than a stop for the same reason a 5xx is a stop -- the rows
 * behind it are deliverable, and stopping would let one unroutable row starve them for as long as
 * it sits at the head of the queue. The primary fix is upstream in the recorder, which must not
 * enqueue such a row in the first place; this branch only protects rows a device already holds.
 */
async function disposeOfEnvelope(
  params: DisposeOfEnvelopeParams,
  candidate: FlushCandidate,
): Promise<EnvelopeDisposition> {
  let payload: unknown;
  try {
    payload = JSON.parse(candidate.payload) as unknown;
  } catch {
    return 'stop'; // unparseable body: never posted, and the batch stops exactly as it always did
  }

  if (!isSyncDiagnosticsPayloadAccepted(payload)) {
    return 'skipped';
  }

  let result;
  try {
    result = await params.client.postSyncDiagnostics(params.connection, payload, {
      timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
    });
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
 * - a body whose `kind` the bridge does not accept: left in place and SKIPPED, never posted and
 *   never deleted, and the batch continues so the deliverable envelopes behind it still go out.
 * - 400/413/422 (THIS envelope is malformed): remove, count as `discarded`, and continue.
 * - every other failure -- 404/408/429/5xx/throw -- leaves the row and STOPS the whole batch,
 *   since the link or the bridge is down and the next rows would fail identically. A parseable
 *   `Retry-After` is persisted as a not-before gate before stopping.
 *
 * Gated FIRST on the user's telemetry switch (`params.config`), resolved through the same predicate
 * the capture path uses: a disabled switch returns the zeroed tally without reading, POSTing,
 * removing or deferring anything, so the queue survives the switch being off untouched.
 */
export async function flushSyncDiagnosticsOutbox(
  params: FlushSyncDiagnosticsOutboxParams,
): Promise<SyncDiagnosticsFlushResult> {
  // FIRST, before the store is even resolved: while the user's switch is off this pass must not
  // build anything, read anything, or write anything. Returning the zeroed tally instead of an
  // empty pass is what keeps queued rows pending -- a removal or a not-before deferral here would
  // quietly consume rows the user never agreed to send. `?? null` is only the type bridge; the
  // predicate already answers nullish with enabled.
  if (!isSyncTelemetryEnabled(params.config ?? null)) {
    return { attempted: 0, delivered: 0, discarded: 0, failedRemovals: 0 };
  }

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
      const disposition = await disposeOfEnvelope({ store, client, connection: params.connection, now }, candidate);

      if (disposition === 'skipped') {
        // Deliberately counted NOWHERE: no request was issued, so `attempted` would be a lie, and
        // the row was not destroyed, so `discarded` would be one too. What it did spend is one of
        // the batch slots -- it keeps its place at the head of the outbox and is re-read by every
        // later pass -- which is exactly why the recorder's acceptance gate, not this defensive
        // one, is what keeps such rows from being written in the first place.
        continue;
      }

      attempted += 1;

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
