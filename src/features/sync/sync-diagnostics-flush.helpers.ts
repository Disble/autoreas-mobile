import { bridgeClient } from '../../infrastructure/api';
import { syncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import { isSyncTelemetryEnabled } from './sync-telemetry-preference.helpers';
import {
  readSyncDiagnosticsRefusalCode,
  resolveSyncDiagnosticsDeferralMs,
  resolveSyncDiagnosticsDisposition,
  shouldReapSyncDiagnosticsParkedRow,
} from './sync-diagnostics-disposition.helpers';
import {
  SYNC_DIAGNOSTICS_ACCEPTED_KINDS,
  SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE,
  SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS,
} from './sync-diagnostics-flush.constants';
import type {
  CaptureSyncDiagnosticsEnvelopeParams,
  FlushSyncDiagnosticsOutboxParams,
  SyncDiagnosticsEnvelopeDisposition,
  SyncDiagnosticsFlushResult,
  SyncDiagnosticsFlushTally,
  SyncDiagnosticsPayloadClass,
  SyncDiagnosticsPostVerdict,
} from './sync-diagnostics-flush.types';
import type { WireSyncCycleTelemetry } from './sync-telemetry.types';
import type {
  BridgeClient,
  BridgeConnection,
} from '../../infrastructure/api/bridge-client/bridge-client.types';
import type { SyncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox';

/** One entry as `readFlushCandidates` hands it back, derived so no extra import is needed. */
type FlushCandidate = ReturnType<SyncDiagnosticsOutboxStore['readFlushCandidates']>[number];

/** Collaborators one whole pass runs against, resolved once and shared by every candidate. */
interface FlushCollaborators {
  readonly store: SyncDiagnosticsOutboxStore;
  readonly client: Pick<BridgeClient, 'postSyncDiagnostics'>;
  readonly now: () => number;
  readonly undeliverableKinds: readonly string[];
}

/** Collaborators one envelope's round trip needs: the pass's own, plus the connection it POSTs to. */
interface DisposeOfEnvelopeParams extends FlushCollaborators {
  readonly connection: BridgeConnection;
}

/**
 * Everything one candidate's round trip resolved to, including the two facts the tally cannot read
 * off the disposition alone once the age bound retires a parked row.
 *
 * `posted` is what keeps `attempted` honest: the row of an unknown `kind` is never sent, so it must
 * not be counted as a request even when the bound retires it, while the routable row a codeless
 * `400` parked WAS sent and must be. `continuesBatch` is the RETIRED disposition's own answer, not
 * the reap's: the age bound changes who removes the row and which counter moves, and never whether
 * the batch may carry on past it. That is what leaves the codeless-`400` park's stop exactly as it
 * was -- the bridge is still the wrong version, so the next row would be refused identically --
 * while the unknown-kind park keeps the continuation it always had.
 */
interface DisposedEnvelope {
  readonly disposition: SyncDiagnosticsEnvelopeDisposition;
  readonly posted: boolean;
  readonly continuesBatch: boolean;
}

/**
 * Resolves one pass's collaborators from the caller's overrides, answering the production default
 * for every one the caller left out (`store`, `client`, `now` and the declared-undeliverable
 * registry are overridable only so a test can substitute them).
 *
 * Extracted so the pass itself carries no fallback ladder: its branching weight belongs to the
 * delivery rules, not to four `??` operators that run before the first candidate is even read.
 */
function resolveFlushCollaborators(params: FlushSyncDiagnosticsOutboxParams): FlushCollaborators {
  return {
    store: params.store ?? syncDiagnosticsOutboxStore,
    client: params.client ?? bridgeClient,
    now: params.now ?? Date.now,
    undeliverableKinds: params.undeliverableKinds ?? SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS,
  };
}

/**
 * True when the bridge currently accepts a stored diagnostics body, judged by the `kind` it declares.
 *
 * A membership test against `SYNC_DIAGNOSTICS_ACCEPTED_KINDS`, reading the body the way the bridge
 * reads it: no `kind` key at all means the kindless legacy cycle envelope (`undefined`), and every
 * other body declares whatever its key holds -- including an explicit `null`, which that registry
 * cannot match. A body that is not an object declares nothing the registry can name, so it is
 * refused rather than guessed at. Refusal is not destruction: see `classifyStoredPayload`.
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
 * Classifies one stored body by its top-level `kind`, the only field the flush ever reads: the body
 * itself stays opaque and reaches the wire byte-identical.
 *
 * The cut is RECOVERABILITY, not familiarity, and it has three positions:
 * - ROUTABLE (`isSyncDiagnosticsPayloadAccepted`) -- absence of `kind` is the frozen legacy rule for
 *   the already-deployed cycle report, and a kind in the accepted registry is deliverable;
 * - UNDELIVERABLE -- a named kind this build DECLARES the bridge refuses forever, so waiting could
 *   never resolve it and the row may be destroyed;
 * - UNCLASSIFIED -- everything else, INCLUDING a `kind` that is present but `null`, a `kind` this
 *   build does not name, and a body that is not a JSON object at all. Those belong to a different
 *   build of this app (an app rollback produces exactly such rows), so rolling forward is what
 *   recovers them and destroying them would turn a recoverable mistake into an irreversible one.
 *
 * ACCEPTED is consulted BEFORE undeliverable on purpose: if a kind were ever placed in both sets,
 * the conflict resolves to POSTing it -- the bridge's own verdict still owns the outcome -- instead
 * of silently destroying a row the registry also claims is deliverable.
 */
function classifyStoredPayload(
  payload: unknown,
  undeliverableKinds: readonly string[],
): SyncDiagnosticsPayloadClass {
  if (isSyncDiagnosticsPayloadAccepted(payload)) {
    return 'routable';
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'unclassified';
  }

  return (undeliverableKinds as readonly unknown[]).includes(
    (payload as { readonly kind?: unknown }).kind,
  )
    ? 'undeliverable'
    : 'unclassified';
}

/**
 * Reads a stored body back as JSON, answering `null` for bytes that are not a JSON value at all.
 *
 * The `null` is not a silent coercion: the classifier refuses every non-object, so unparseable
 * bytes and a literal `null` body land on the SAME class (`'unclassified'`): never posted, never
 * deleted, and the batch carries on past them.
 */
function parseStoredPayload(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

/**
 * POSTs one routable body and answers the bridge's verdict, or `null` when the request THREW.
 *
 * `null` is the transport-failure signal, not a verdict, and `resolveSyncDiagnosticsDisposition`
 * reads it as `'stop'`. The swallow contract lives here now (was inline in the old ladder): a
 * delivery failure can never reach a caller as an exception, so it can never be mistaken for the
 * cycle's own failure.
 *
 * This is also the ONE place the wide transport result is distilled into the narrow verdict the
 * ladder reads: `ok`, `status` and `retryAfterMs` are copied across, and the refusal's declared
 * meaning is read out of the response body by `readSyncDiagnosticsRefusalCode`. Keeping the
 * distillation here is what lets the ladder branch on a vocabulary member instead of on raw bytes
 * -- it never sees `rawBody`, `data` or `url` -- and the read itself is safe inside the try because
 * it answers `null` rather than throwing for every body it cannot read.
 */
async function postStoredPayload(
  params: DisposeOfEnvelopeParams,
  payload: unknown,
): Promise<SyncDiagnosticsPostVerdict | null> {
  try {
    const result = await params.client.postSyncDiagnostics(params.connection, payload, {
      timeoutMs: SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS,
    });

    return {
      ok: result.ok,
      status: result.status,
      retryAfterMs: result.retryAfterMs,
      refusalCode: readSyncDiagnosticsRefusalCode(result.rawBody),
    };
  } catch {
    return null;
  }
}

/**
 * Persists the not-before gate a retryable verdict declared, if it declared one at all.
 *
 * The wait itself is a DECISION and lives in `resolveSyncDiagnosticsDeferralMs`; this only writes
 * it through the store, so the ladder never has to know a clock exists.
 */
function deferStoredEnvelope(
  params: DisposeOfEnvelopeParams,
  verdict: SyncDiagnosticsPostVerdict | null,
): void {
  const retryAfterMs = resolveSyncDiagnosticsDeferralMs(verdict);

  if (retryAfterMs !== null) {
    params.store.deferUntil(params.now() + retryAfterMs);
  }
}

/**
 * Applies one already-resolved disposition -- the ONLY outbox write a disposition authorizes -- and
 * answers what the pass must count that candidate as, plus whether it may continue the batch.
 *
 * Thin on purpose: the ladder lives in `resolveSyncDiagnosticsDisposition`, which knows nothing
 * about stores, clients or clocks, and this knows nothing about verdicts beyond their persistence.
 * The single exceptions are the 2xx path, where `'delivered'` can only be claimed after CONFIRMING
 * the removal (Decision 2/3), and the age bound, which retires a row the ladder decided to KEEP --
 * `shouldReapSyncDiagnosticsParkedRow` owns that decision (parked? older than the declared bound?),
 * and this only performs the removal it authorizes.
 */
function applySyncDiagnosticsDisposition(
  params: DisposeOfEnvelopeParams,
  candidate: FlushCandidate,
  disposition: SyncDiagnosticsEnvelopeDisposition,
  verdict: SyncDiagnosticsPostVerdict | null,
): DisposedEnvelope {
  // Read BEFORE anything is written: these two describe the disposition the LADDER reached, which
  // the reap may replace but never re-decides.
  const posted = disposition !== 'unclassified' && disposition !== 'undeliverable';
  const continuesBatch = disposition !== 'stop';

  if (
    shouldReapSyncDiagnosticsParkedRow(
      disposition,
      verdict,
      params.now() - candidate.createdAt,
    )
  ) {
    // The bound expired on a PARKED row: retired exactly like the two destruction dispositions, and
    // counted apart from both of them. Reached only for a park, so a row whose fate a verdict already
    // decided can never arrive here however old it is.
    params.store.remove(candidate.cycleId);

    return { disposition: 'reaped', posted, continuesBatch };
  }

  if (disposition === 'unclassified') {
    return { disposition, posted, continuesBatch }; // parked: never posted, never deleted
  }

  if (disposition === 'delivered') {
    return {
      disposition: params.store.remove(candidate.cycleId) === 'removed' ? 'delivered' : 'failed_removal',
      posted,
      continuesBatch,
    };
  }

  if (disposition === 'stop') {
    deferStoredEnvelope(params, verdict);

    return { disposition, posted, continuesBatch };
  }

  // The two destruction dispositions, which differ in AUTHORITY and not in effect: `discarded` is
  // the bridge's own permanence verdict, `undeliverable` is this build's positive declaration that
  // the bridge would answer the same forever. Both remove; both were counted where they were
  // resolved. Never posted when `undeliverable`, since no request is spent learning what the
  // registry already declared.
  params.store.remove(candidate.cycleId);

  return { disposition, posted, continuesBatch };
}

/**
 * Resolves one envelope's round trip into a single disposition and applies it.
 *
 * Deliberately two steps rather than one function: `resolveSyncDiagnosticsDisposition` DECIDES from
 * the routing class and the POST verdict alone, and `applySyncDiagnosticsDisposition` performs the
 * one store write that decision authorizes. The swallow contract is unchanged -- a transport failure
 * is not an exception here, it is a `null` verdict the ladder reads as `'stop'`.
 *
 * A row that routes nowhere is reported as `'unclassified'` (parked) or `'undeliverable'`
 * (destroyed by declaration) rather than `'stop'`: the rows behind it are deliverable, and stopping
 * would let one unroutable row starve them for as long as it sits at the head of the queue. The
 * same reasoning applies to a body that does not parse: unreadable bytes are poisoned for THIS
 * build, not for the bridge, so they park and the batch continues.
 */
async function disposeOfEnvelope(
  params: DisposeOfEnvelopeParams,
  candidate: FlushCandidate,
): Promise<DisposedEnvelope> {
  const payload = parseStoredPayload(candidate.payload);
  const classification = classifyStoredPayload(payload, params.undeliverableKinds);
  // Only a ROUTABLE body is ever posted: the other two classes answer from the registry alone, and
  // spending a request to learn what this build already declared would buy nothing.
  const verdict = classification === 'routable' ? await postStoredPayload(params, payload) : null;
  const disposition = resolveSyncDiagnosticsDisposition(classification, verdict);

  return applySyncDiagnosticsDisposition(params, candidate, disposition, verdict);
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
 * Runs ONE candidate through the disposition ladder and folds the answer into the running tallies.
 *
 * Answers whether the batch may continue: only a `'stop'` verdict closes it, since the next row
 * would fail identically. That answer is the RETIRED disposition's own -- the age bound changes who
 * removes a parked row and which counter moves, never whether the batch may carry on past it.
 *
 * `attempted` counts REQUESTS, so it is read from whether one was spent: an unknown-kind row is
 * never sent, so the bound must not turn it into a request when it retires one, while the routable
 * row a codeless `400` parked WAS sent and must be.
 *
 * `reaped` is the AGE BOUND's own counter, and it stays distinct from both of the counters it could
 * be confused with. Not `discarded`: the bridge condemned nothing here -- it declared nothing at
 * all, or does not name the kind -- and folding the two together would make a non-zero `discarded`
 * unable to separate "the bridge refused these bytes" from "we gave up waiting for a bridge that
 * would have accepted them", which are opposite conclusions about the client. Not `shed`: that one
 * is the cap dropping rows for capacity, while a reap is a decision about one row.
 *
 * `unclassified` is deliberately NOT `attempted`: no request was issued, so `attempted` would be a
 * lie, and nothing was destroyed, so `discarded` would be one too. What such a row spends is one of
 * the batch slots -- it keeps its place at the head of the outbox and is re-read by every later
 * pass -- which is why the recorder's acceptance gate, not this defensive one, is what keeps such
 * rows from being written in the first place. Both parks share ONE age bound: whichever of them
 * outlives it leaves through `reaped`, which is the only state either can exit by.
 *
 * The three `stop` cases (a transport failure, the ONE recoverable refusal code, and a codeless
 * `400` -- a bridge older than the refusal vocabulary) share `attempted` alone, all of them "posted,
 * kept, nothing destroyed". The codeless `400` is deliberately NOT `unclassified`: that counter is
 * documented as a body never posted whose `kind` this build does not know, while this one WAS posted
 * and was routable -- a different fact, decided by a different input. Past the bound it is retired
 * as `reaped` instead of stopping here, so the shared trace is left only for rows still inside the
 * wait.
 */
async function tallyFlushCandidate(
  tallies: SyncDiagnosticsFlushTally,
  params: DisposeOfEnvelopeParams,
  candidate: FlushCandidate,
): Promise<boolean> {
  const { disposition, posted, continuesBatch } = await disposeOfEnvelope(params, candidate);

  if (posted) {
    tallies.attempted += 1;
  }

  if (disposition === 'reaped') {
    tallies.reaped += 1;
  } else if (disposition === 'unclassified') {
    tallies.unclassified += 1;
  } else if (disposition === 'undeliverable') {
    tallies.undeliverable += 1;
  } else if (disposition === 'delivered') {
    tallies.delivered += 1;
  } else if (disposition === 'failed_removal') {
    tallies.failedRemovals += 1;
  } else if (disposition === 'discarded') {
    tallies.discarded += 1;
  }

  return continuesBatch;
}

/**
 * Attempts delivery of up to `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE` oldest eligible entries, oldest
 * first -- the same order eviction uses, so the row closest to being destroyed is sent first.
 *
 * NEVER REJECTS (Decision 5): a diagnostics-delivery failure must never be the reason a sync
 * cycle fails. Per-envelope disposition, classified by RECOVERABILITY from the body's top-level
 * `kind` before any request is made:
 * - `kind` absent or in the accepted registry: ROUTABLE. 2xx is delivered only if the removal is
 *   CONFIRMED (Decision 2/3) -- an unconfirmed removal counts as `failedRemovals` instead, since
 *   the row is still there for the next cycle to re-send.
 * - `kind` declared undeliverable: destroyed on sight, counted as `undeliverable`, batch continues.
 * - everything else (`kind` unknown, `kind` null, body not a JSON object): PARKED -- never posted,
 *   never deleted, counted as `unclassified`, and the batch CONTINUES, so one row this build does
 *   not understand cannot starve the deliverable envelopes behind it.
 * - a row EITHER park kept, once it is older than `SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS`: retired
 *   and counted as `reaped`, which is the only removal in this pass that is neither a bridge verdict
 *   nor this build's declaration. The bound exists for liveness: a park sits at the HEAD of an
 *   oldest-first queue and the cap sheds the TAIL, so an indefinite mismatch eventually spends the
 *   whole retained window on rows that can never drain and sheds the telemetry that would have. A
 *   clock is also the one authority a `reaped` row needs, because nothing in the response was a
 *   judgement about its bytes.
 * - a `413` with or without a code, or a `400` that DECLARED a code (the bridge's whole permanence
 *   rule): remove, count as `discarded`, continue -- UNLESS the refusal declared `kind_not_served`,
 *   the vocabulary's only recoverable member, which keeps the row and stops the batch exactly as an
 *   undeclared verdict does.
 * - a `400` that declared NO code (an absent one, or a blank one, which occupies the same state):
 *   KEEP the row and STOP the batch, destroying nothing -- until the row exceeds the age bound, at
 *   which point it is retired as `reaped` and the batch still stops. Reading it as a verdict is the
 *   defect this rule closes: a bridge older than the refusal vocabulary (the shipped 1.14.0 declares
 *   no `kind` at all, so it answers the generic `400 {"error":"invalid request body"}` with no
 *   `field` and no `code`) says nothing about these bytes -- it names its own version -- and reading
 *   that answer as permanence destroyed the whole episode backlog, whose only copy is this outbox, on
 *   first contact with a bridge that was never upgraded.
 * - every other failure -- 401/404/408/422/429/5xx/throw -- leaves the row and STOPS the whole batch,
 *   since the link or the bridge is down and the next rows would fail identically. A usable
 *   `Retry-After`, or the bridge's declared wait for a `503` that lost its header, is persisted as
 *   a not-before gate before stopping.
 *
 * Gated FIRST on the user's telemetry switch (`params.config`), resolved through the same predicate
 * the capture path uses: a disabled switch returns the zeroed tally without reading, POSTing,
 * removing or deferring anything, so the queue survives the switch being off untouched.
 *
 * The pass itself is now a loop and a tally: the ladder that decides one body's fate is the pure
 * `resolveSyncDiagnosticsDisposition` (sync-diagnostics-disposition.helpers.ts), the single write a
 * disposition authorizes is `applySyncDiagnosticsDisposition`, and one candidate's accounting is
 * `tallyFlushCandidate`.
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
    return {
      attempted: 0,
      delivered: 0,
      discarded: 0,
      failedRemovals: 0,
      undeliverable: 0,
      unclassified: 0,
      reaped: 0,
    };
  }

  const { store, client, now, undeliverableKinds } = resolveFlushCollaborators(params);

  // The mutable accumulator; the public result is this object with its members made `readonly`, so
  // zeroing it in one place is what keeps a counter from being forgotten in another.
  const tallies: SyncDiagnosticsFlushTally = {
    attempted: 0,
    delivered: 0,
    discarded: 0,
    failedRemovals: 0,
    undeliverable: 0,
    unclassified: 0,
    reaped: 0,
  };

  try {
    const candidates = store.readFlushCandidates(SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE, now());
    const disposerParams: DisposeOfEnvelopeParams = {
      store,
      client,
      connection: params.connection,
      now,
      undeliverableKinds,
    };

    for (const candidate of candidates) {
      if (!(await tallyFlushCandidate(tallies, disposerParams, candidate))) {
        break;
      }
    }
  } catch {
    // Swallowed by contract (Decision 5): instrumentation delivery must never fail the cycle.
  }

  return { ...tallies };
}
