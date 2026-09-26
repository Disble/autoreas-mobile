import {
  SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS,
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
 * any future refusal written outside the handler carry no code at all. `null` means "no code
 * declared", which is deliberately NOT the same state as a code this build does not know: that one
 * still names a vocabulary member. What a MISSING code means is decided by the status and by
 * nothing else (see `isSyncDiagnosticsPermanentRejection`): a `401` keeps the verdict its status
 * declares, and a `400` becomes a version state -- a bridge that does not speak the vocabulary --
 * rather than a verdict about these bytes.
 *
 * A BLANK code is `null` too, and that is a decision rather than tidiness. The premise of "a `400`
 * that declares a code is permanent" is that the code names THESE BYTES refused forever, and `""`
 * or whitespace names nothing: it is not a member of the closed vocabulary. Read as a declaration
 * (which `code !== null` did), an empty field became a destruction verdict and discarded the row.
 * The declared TEXT is returned untouched rather than trimmed, so an unrecognised non-blank code
 * still keeps the status verdict: `kind_not_served` is the only recoverable member the bridge
 * declares, and widening the recovery would need the vocabulary list this build must not keep.
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

  return typeof code === 'string' && code.trim() !== '' ? code : null;
}

/**
 * Whether one refusal is a verdict about THESE BYTES -- the only thing that makes destroying them
 * justified. This is the bridge's whole permanence declaration for `POST /api/sync/diagnostics`,
 * refined by the contract to `413` unconditionally and `400` only when the body DECLARES a code:
 *
 * - **`413` is permanent with or without a code.** Size is a property of the bytes themselves, and
 *   no build makes a body smaller: an oversize refusal stays true for every bridge there will ever
 *   be, so a bridge too old to declare a code still means "these bytes are too large".
 * - **`400` is permanent only when the refusal declared a code.** A code names a member of the
 *   closed refusal vocabulary and therefore a judgement about these bytes. A `400` that declares no
 *   code carries no judgement at all: it is the answer of a bridge OLDER than the vocabulary. The
 *   shipped 1.14.0 strict-decodes the body into a report that declares no `kind` at all, so it
 *   answers the generic `400 {"error":"invalid request body"}` with no `field` and no `code`, and
 *   that build is immutable -- no client-side rule can make it answer differently. Reading it as a
 *   verdict would destroy the user's whole episode backlog, whose only copy is this outbox, on the
 *   first cycle after a bridge that was never upgraded; keeping the row costs a stall that ends
 *   when the bridge does.
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
function isSyncDiagnosticsPermanentRejection(verdict: SyncDiagnosticsPostVerdict): boolean {
  // Literal statuses on purpose: they ARE the contract, and the tests assert the same literals, so
  // mutating either side of this rule cannot leave the pair silently agreeing with each other.
  if (verdict.status === 413) {
    return true;
  }

  return verdict.status === 400 && verdict.refusalCode !== null;
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
 * - ROUTABLE rejected by the bridge's permanence rule -- a `413` with or without a code, or a `400`
 *   that DECLARED a code -- is `'discarded'`;
 * - ROUTABLE refused with a `400` that declared NO code stops the batch and destroys nothing: no
 *   declaration was made about these bytes, so the answer names the bridge's own version rather
 *   than the envelope, and a later bridge resolves it;
 * - every other verdict -- `401`, `404`, `408`, `422`, `429`, `5xx` -- stops the batch and destroys
 *   nothing, because the contract does not declare those bytes permanently unacceptable.
 *
 * The recoverable code is checked BEFORE the permanence rule, and that order is the contract: it is
 * not a status list per refusal class (which would have to be re-released every time the bridge
 * grows a vocabulary member) but ONE exception keyed on the refusal's own declared meaning. The
 * status still owns permanence for every other member, and a refusal that declares no code at all
 * -- `401` is written by the shared authentication layer, not the handler -- keeps the status
 * verdict, never this exception.
 *
 * The three stops above are ONE disposition because they ask one thing of the executor -- keep the
 * row, stop the batch -- while remaining three different FACTS, which is why none of them is
 * recorded as a destruction and why the two parks are not conflated with each other: a codeless
 * `400` is a state of the BRIDGE, while the `'unclassified'` park above (never posted, never
 * counted as attempted) is a gap in this build's kind registry.
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

  return isSyncDiagnosticsPermanentRejection(verdict) ? 'discarded' : 'stop';
}

/**
 * Whether ONE kept row is PARKED rather than merely PENDING -- the split the age bound rests on, and
 * the reason a clock may retire this row but must never touch another.
 *
 * A row is parked when its cause is a MISMATCH between this build and the bridge's version, so no
 * amount of retrying resolves it and only an operator action (a new bridge, or a roll-forward of
 * our own app) does. There are exactly two such causes, and they are the repository's own two
 * parks:
 * - `unclassified`: this build does not name the row's `kind`, so the row belongs to a different
 *   build of our own app and rolling forward recovers it;
 * - `stop` after a `400` that declared NO code: the bridge predates the refusal vocabulary, so its
 *   answer names its own version rather than judging these bytes.
 *
 * Everything else that keeps a row is PENDING, and a clock must never destroy it. A transport
 * failure (`null`, no verdict at all), a `401`, a `404`, a `405`, a `408`, a `422`, a `429` and
 * every `5xx` are the bridge asking us to come back, not a judgement about the envelope; and the ONE
 * declared recoverable code is a refusal the bridge DID make, whose own rule is to keep the row and
 * forward-roll it. Reaping any of them by age would lose a backlog on nothing worse than a long
 * outage, which is the opposite of what the bound is for.
 */
function isSyncDiagnosticsParkedDisposition(
  disposition: SyncDiagnosticsEnvelopeDisposition,
  verdict: SyncDiagnosticsPostVerdict | null,
): boolean {
  if (disposition === 'unclassified') {
    return true;
  }

  return disposition === 'stop' && verdict !== null && verdict.status === 400 && verdict.refusalCode === null;
}

/**
 * Whether the age bound should RETIRE one already-kept candidate -- the exact rule behind the
 * `reaped` counter, and the ONLY destruction in this pipeline that is not a verdict or a
 * declaration.
 *
 * It is a conjunction, and the order is the point: the row must be PARKED before its age is even
 * looked at, so no clock can remove a row whose fate belongs to a verdict (see
 * `isSyncDiagnosticsParkedDisposition`). The age test is strict -- a row is retired once it EXCEEDS
 * the declared bound, never when it merely reaches it, so the bound reads as "how long we wait"
 * rather than "the first instant we can" -- and it compares the row's OWN `created_at` against the
 * pass's clock, both supplied by the caller: this module stays pure, with no store, client or clock
 * of its own.
 *
 * The age is computed by the CALLER (`now - candidate.createdAt`) so that a row's age has exactly
 * one definition and it lives where the clock does.
 */
export function shouldReapSyncDiagnosticsParkedRow(
  disposition: SyncDiagnosticsEnvelopeDisposition,
  verdict: SyncDiagnosticsPostVerdict | null,
  rowAgeMs: number,
): boolean {
  return (
    isSyncDiagnosticsParkedDisposition(disposition, verdict) &&
    rowAgeMs > SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS
  );
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
