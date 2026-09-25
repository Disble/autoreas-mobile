import {
  SYNC_DIAGNOSTICS_RECOVERABLE_REFUSAL_CODE,
  SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS,
} from './sync-diagnostics-flush.constants';
import type {
  SyncDiagnosticsEnvelopeDisposition,
  SyncDiagnosticsPayloadClass,
  SyncDiagnosticsPostVerdict,
} from './sync-diagnostics-flush.types';

/**
 * Reads the bridge's refusal `code` out of one raw response body, best effort -- `null` whenever the
 * body declares no code this build can read.
 *
 * This is where the wire stops and the vocabulary starts: the transport answers with bytes, and the
 * disposition ladder below is only allowed to branch on a MEANING, so the distillation from body to
 * declared code happens here, once, instead of inside that decision (which cannot see `rawBody`).
 *
 * Every failure mode is a `null`, and none of them throws -- the fallback to the status verdict has
 * to survive a body that is absent, not a string, not JSON, or not a JSON object, because `401` and
 * any future refusal written outside the handler carry no code at all and must keep the verdict
 * their status declares. `null` means "no code declared", which is deliberately NOT the same state
 * as a code this build does not know: that one still names a vocabulary member, and neither is ever
 * read as "unclassified" or as `kind_not_served`.
 */
export function readSyncDiagnosticsRefusalCode(body: unknown): string | null {
  if (typeof body !== 'string') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const code = (parsed as { readonly code?: unknown }).code;

  return typeof code === 'string' ? code : null;
}

/**
 * The bridge's ENTIRE permanence declaration for `POST /api/sync/diagnostics` -- exactly `400` and
 * `413`, per the contract agreed with team-bridge (odd/tasks/chapter-action-diagnostics.md).
 *
 * The general rule that makes this short list safe to remember: **permanence is declared by the
 * bridge's contract and by nothing else, so anything the contract does not declare must be treated
 * as retryable.** NOT `isPermanentReconcileError`'s blanket `>= 400 && < 500`
 * (`reconcile.helpers.ts:62-64`): `404` (the endpoint before it ships), `408` and `429` condemn
 * nothing about the envelope's content. `405` is not a body verdict at all -- a client that always
 * POSTs can only see it through a routing bug. `422` was REMOVED for the same reason: it was here by
 * inheritance from the bridge's `season_rating_handler.go`, a DIFFERENT endpoint whose answer about
 * a grade says nothing about whether these bytes are refused forever. Re-adding it requires the
 * bridge to declare a permanent `422` for THIS endpoint.
 */
function isSyncDiagnosticsEnvelopeRejection(status: number): boolean {
  return status === 400 || status === 413;
}

/**
 * Resolves ONE candidate's disposition from the two things that actually decide it: what this build
 * knows about the body before posting (its routing class) and what the bridge answered afterwards
 * (`null` meaning the request never produced a verdict, i.e. transport failure or no post at all).
 *
 * Pure on purpose: no store, no client, no clock, no I/O. That is what makes the ladder readable as
 * a table -- and what keeps its branches out of the executor that performs the writes, so the two
 * can be reasoned about (and changed) separately.
 *
 * The ladder, in order:
 * - a class that is not ROUTABLE answers for itself -- `'unclassified'` parks, `'undeliverable'` is
 *   destroyed by this build's own declaration -- and no request is ever issued for it;
 * - ROUTABLE with no verdict is a transport failure, so the batch stops;
 * - ROUTABLE with an `ok` verdict is a delivery (the executor still has to confirm the removal);
 * - ROUTABLE refused with the ONE recoverable code (`kind_not_served`) stops the batch and destroys
 *   nothing: the bytes are not wrong, this build merely does not serve that kind, and forwarding
 *   them to a bridge that does recovers every one of them unchanged;
 * - ROUTABLE rejected by the bridge's permanence set (`400`/`413`) is `'discarded'`;
 * - every other verdict -- `401`, `404`, `408`, `422`, `429`, `5xx` -- stops the batch and destroys
 *   nothing, because the contract does not declare those bytes permanently unacceptable.
 *
 * The recoverable code is checked BEFORE the permanence set, and that order is the contract: it is
 * not a status list per refusal class (which would have to be re-released every time the bridge
 * grows a vocabulary member) but ONE exception keyed on the refusal's own declared meaning. The
 * status still owns permanence for every other member, and a refusal that declares no code at all
 * -- `401` is written by the shared authentication layer, not the handler -- keeps the status
 * verdict, never this exception.
 */
export function resolveSyncDiagnosticsDisposition(
  classification: SyncDiagnosticsPayloadClass,
  verdict: SyncDiagnosticsPostVerdict | null,
): SyncDiagnosticsEnvelopeDisposition {
  if (classification !== 'routable') {
    return classification;
  }

  if (verdict === null) {
    return 'stop'; // transport throw: the link or the bridge is down
  }

  if (verdict.ok) {
    return 'delivered';
  }

  if (verdict.refusalCode === SYNC_DIAGNOSTICS_RECOVERABLE_REFUSAL_CODE) {
    return 'stop';
  }

  return isSyncDiagnosticsEnvelopeRejection(verdict.status) ? 'discarded' : 'stop';
}

/**
 * The wait a retryable verdict declared, or `null` when it declared none -- the decision the
 * executor's `deferUntil` write exists to carry out.
 *
 * Two sources, in this order: the response's own usable `Retry-After`, and the bridge's declared
 * wait for the one verdict that declares a wait of its own -- a `503` whose header never arrived is
 * still a request for room, so the gate closes by the declared amount instead of leaving the next
 * trigger to hammer it. `null` keeps every other status gated exactly as before: no invented
 * backoff for `401`/`404`/`408`/`422`/`429`/`500`, and none for a transport failure either, which
 * produced no verdict to declare one.
 */
export function resolveSyncDiagnosticsDeferralMs(
  verdict: SyncDiagnosticsPostVerdict | null,
): number | null {
  if (verdict === null) {
    return null;
  }

  if (verdict.retryAfterMs !== null) {
    return verdict.retryAfterMs;
  }

  return verdict.status === 503 ? SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS : null;
}
