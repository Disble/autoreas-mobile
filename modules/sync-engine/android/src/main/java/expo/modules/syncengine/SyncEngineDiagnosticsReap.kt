package expo.modules.syncengine

import org.json.JSONException
import org.json.JSONObject

/**
 * The PURE disposition decisions that decide what may happen to one stored diagnostics body, kept
 * apart from the ladder that applies them (`SyncEngineDiagnosticsCourier.drain`) exactly as the JS
 * side keeps them (`sync-diagnostics-disposition.helpers.ts` against
 * `sync-diagnostics-flush.helpers.ts`).
 *
 * Deliberately pure: no store, no client, no clock, no I/O. That is what makes these rules readable
 * as a table, lets a test assert them directly instead of inferring them from a drain, and keeps the
 * branches that decide DESTRUCTION out of the code that performs the writes -- so the two can be
 * reasoned about, and changed, separately.
 *
 * The file is named for the REAP because that age bound is what this round adds and it is the one
 * rule here that authorises a removal no verdict asked for. The routing class, the refusal reader
 * and the permanence rule moved here out of the courier so the decisions sit together; the courier
 * keeps the transport, the budget and the loop, which is the same cut the JS side makes.
 */

/**
 * One stored body's routing class, decided by the ONE field the bridge classifies on.
 */
internal enum class DiagnosticsPayloadKind {
  /** POST it; delete only on a definitive verdict. */
  ROUTABLE,

  /** Never POST it; delete on sight, because this build declares the bridge cannot take it. */
  UNDELIVERABLE,

  /**
   * Never POST it, and never delete it in answer to a VERDICT or in answer to a declaration: it
   * belongs to another build of this app, and rolling forward is what recovers it. A clock may
   * still retire it once it outlives the declared bound (see [shouldReapParkedDiagnosticsRow]),
   * because waiting forever is a LIVENESS failure rather than a durability one.
   */
  UNCLASSIFIED,
}

/**
 * Classifies one stored body by its top-level `kind`, the only field the drain ever reads: the body
 * itself stays opaque and reaches the wire byte-identical.
 *
 * The cut is RECOVERABILITY, not familiarity (odd/tasks/chapter-action-diagnostics.md):
 * - the ABSENCE of `kind` -- and nothing else -- is ROUTABLE: it is the kindless legacy cycle
 *   envelope, the shape already-deployed builds send and the one the bridge's frozen compatibility
 *   rule accepts. Parking it would strand a deployed build's queue on a field it never sent;
 * - a NAMED kind in [acceptedKinds] is ROUTABLE;
 * - a NAMED kind in [undeliverableKinds] is UNDELIVERABLE -- destroyed by explicit declaration;
 * - every other DECLARATION is UNCLASSIFIED -- parked and counted, never posted and never deleted
 *   by a verdict. That covers a kind string in neither set, a `kind` that is not even a string (a
 *   number or an object), a `kind` that is present but JSON `null`, and bytes that do not parse as a
 *   JSON object at all.
 *
 * The last two are ALIGNED with the JS drainer's `disposeOfEnvelope`, not a divergence from it:
 * both drainers read the same outbox, so a disagreement about what is routable would be a
 * disagreement about what is DESTROYED. Parking is the safe side of both because destruction
 * requires a POSITIVE declaration: the frozen rule is about the `kind` KEY being absent, so a
 * present `null` declares a value this build cannot name rather than an absence (the bridge's
 * strict decode answers it 400, and a 400 is definitive -- routing it would DELETE the row); and
 * this build cannot read any declaration out of bytes it cannot parse into an object. Such bytes
 * are only ever authored by a build that is not this one, and the bridge's own verdict still owns
 * their fate once this build does route their kind. Parking never STOPS the batch either: one row
 * this build does not understand must not strand the deliverable envelopes behind it.
 *
 * UNCLASSIFIED is what a rollback to an older build of this app looks like, and rolling forward is
 * what recovers it, so destroying it in answer to a verdict would convert a recoverable registry
 * mistake into an irreversible loss. The one removal it does not survive is the age bound, which is
 * about how long this drain waits rather than about whether the bytes are declared bad.
 */
internal fun classifyDiagnosticsPayload(
  payload: String,
  acceptedKinds: Set<String>,
  undeliverableKinds: Set<String>,
): DiagnosticsPayloadKind {
  // Bytes this build cannot read as an object carry no readable `kind` -- and also no positive
  // declaration, so they park. They are NOT the legacy envelope: its marker is an absent key, and
  // `JSON.parse` does not fail for it in the JS drainer either.
  val envelope = try {
    JSONObject(payload)
  } catch (error: JSONException) {
    return DiagnosticsPayloadKind.UNCLASSIFIED
  }

  if (!envelope.has("kind")) return DiagnosticsPayloadKind.ROUTABLE
  // Present but JSON `null`: the key EXISTS, so this is a declaration. `has` is true and the value
  // is the null sentinel, which names no token this build knows -- so it parks with every other
  // unnamed declaration rather than being read as the legacy envelope's absent key.
  if (envelope.isNull("kind")) return DiagnosticsPayloadKind.UNCLASSIFIED

  // `optString` renders a non-string token too (a number, an object), which then matches no set and
  // parks -- the conservative direction for a declaration this build cannot name.
  val kind = envelope.optString("kind", "")
  return when {
    kind.isBlank() -> DiagnosticsPayloadKind.UNCLASSIFIED
    acceptedKinds.contains(kind) -> DiagnosticsPayloadKind.ROUTABLE
    undeliverableKinds.contains(kind) -> DiagnosticsPayloadKind.UNDELIVERABLE
    else -> DiagnosticsPayloadKind.UNCLASSIFIED
  }
}

/**
 * Reads the bridge's refusal `code` out of a response body, best effort; mirrors the JS drainer's
 * `readSyncDiagnosticsRefusalCode`. Every unreadable shape -- absent body, non-string `code`,
 * non-JSON bytes, a body that is not an object -- answers `null` and none throws, so the status
 * verdict always survives: `null` is "no code declared" (the shared-authentication `401` and any
 * pre-discriminated bridge), never the recoverable refusal and never a class of its own.
 *
 * A BLANK code answers `null` too, and that is a decision rather than tidiness. The premise of "a
 * `400` that DECLARED a code is permanent" is that the code names THESE BYTES refused forever, and
 * `""` or whitespace names nothing: it is not a member of the closed vocabulary. Read as a
 * declaration -- which `!= null` did -- an empty field became a destruction verdict and the row was
 * discarded, which is the same defect the codeless-`400` rule closes from the other side. The
 * declared TEXT is deliberately returned untouched rather than trimmed, so an unrecognised non-blank
 * code still keeps the verdict its status declares: `kind_not_served` is the only recoverable member
 * the bridge declares, and widening the recovery would need the vocabulary list this build must not
 * keep.
 */
fun readDiagnosticsRefusalCode(body: String?): String? {
  if (body.isNullOrEmpty()) return null
  val envelope = try {
    JSONObject(body)
  } catch (error: JSONException) {
    return null
  }
  return (envelope.opt("code") as? String)?.takeIf { it.trim().isNotEmpty() }
}

/**
 * Whether one refusal is a verdict about THESE BYTES, which is the only thing that makes destroying
 * them justified; mirrors the JS drainer's `isSyncDiagnosticsPermanentRejection`.
 *
 * This is the bridge's whole permanence declaration for `POST /api/sync/diagnostics`, refined by the
 * contract to `413` unconditionally and `400` ONLY when the refusal DECLARED a code:
 *
 * - **`413` is permanent with or without a code.** Size is a property of the bytes themselves, and
 *   no build makes a body smaller: an oversize refusal stays true for every bridge there will ever
 *   be, so a bridge too old to declare a code still means "these bytes are too large".
 * - **`400` is permanent only when a code was DECLARED**, because a code names a member of the
 *   closed refusal vocabulary and therefore a judgement about these bytes. A codeless `400` carries
 *   no judgement at all: it is the answer of a bridge OLDER than the vocabulary. The shipped 1.14.0
 *   strict-decodes the body into a report that declares no `kind` at all, so it answers the generic
 *   `400 {"error":"invalid request body"}` with no `field` and no `code`, and that build is
 *   immutable -- no client-side rule can make it answer differently. Reading it as permanence
 *   destroyed the user's whole episode backlog, whose only copy is the outbox, on the first cycle
 *   after a bridge that was never upgraded; the row is KEPT instead and the batch stops (see
 *   [isParkedDiagnosticsRow]).
 *
 * The general rule that makes this short list safe to remember: permanence is declared by the
 * bridge's contract and by nothing else, so anything the contract does not declare must be treated
 * as retryable. It is NOT a blanket `>= 400 && < 500`: `404` (the endpoint before it ships), `405`
 * (reachable only through a routing bug, since this client always POSTs), `408`, `422` and `429`
 * condemn nothing about the envelope's content, and `422` was REMOVED from the set because it was
 * here by inheritance from another endpoint's handler whose answer about a grade says nothing about
 * these bytes. Re-adding it requires the bridge to declare a permanent `422` for THIS endpoint.
 *
 * [refusalCode] is the DECLARED meaning already distilled out of the response body by
 * [readDiagnosticsRefusalCode], so a blank field arrives here as `null` and is read as no
 * declaration. The statuses are literals on purpose -- they ARE the contract, and the tests assert
 * the same literals -- so mutating either side of the rule cannot leave the pair silently agreeing
 * with itself.
 */
internal fun isPermanentDiagnosticsRejection(status: Int, refusalCode: String?): Boolean {
  if (status == HTTP_PAYLOAD_TOO_LARGE) return true
  return status == HTTP_BAD_REQUEST && refusalCode != null
}

private const val HTTP_BAD_REQUEST = 400
private const val HTTP_PAYLOAD_TOO_LARGE = 413

/**
 * How long a PARKED row waits in the outbox before a drain gives up on it and REAPS it -- the one
 * clock in this pipeline, and the only removal besides the bridge's own verdict and this build's own
 * declaration; mirrors the JS drainer's `SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS`.
 *
 * A PARK is a mismatch between this build and the bridge's VERSION, and nothing this app does on its
 * own resolves it: either the row's `kind` is one this build does not name (another build of our own
 * app wrote it, which a roll-forward recovers), or the bridge answered a `400` that declared NO code
 * (it predates the refusal vocabulary, so it never judged these bytes). Both park the row at the HEAD
 * of an oldest-first queue while the cap sheds the TAIL, so a long-lived mismatch spends every batch
 * on rows that can never drain and sheds the telemetry that WOULD have delivered. The bound turns
 * that indefinite stall into a bounded wait, and `reaped` is the operator signal that it expired. It
 * lands on how long we WAIT, never on whether the bytes are declared bad.
 *
 * ONE WEEK, measured against the OPERATOR's response rather than against any retry cadence: every
 * cadence this app owns is seconds-to-minutes (a 15-minute background floor, a 45-second cycle
 * budget, a 5-second not-before gate) and none of them can change the version on either side, so the
 * real question is how long a person takes to install a bridge or roll the app forward -- days. The
 * row is the ONLY copy from the moment it is captured, so the wait has to cover at least one
 * plausible human response cycle. It is a REAL bound and not a longer stall: the retained window is
 * at most the outbox cap (100 rows) and a pass retires up to the batch size (3) of them, while a
 * transport outage never reaches this bound at all -- a row the bridge never answered about is
 * PENDING, and no clock may destroy it.
 *
 * DUPLICATION RISK, named because this one is a data-loss boundary: the JS drainer holds this same
 * value across a language boundary with NO shared artifact, so the two can drift silently. Drift
 * here is not cosmetic -- it is a disagreement about WHEN a stored row may be destroyed, and both
 * drainers read the same outbox, so in practice the SHORTER bound decides. Lowering either lengthens
 * the stall; raising either destroys rows a slower operator would have recovered.
 */
const val SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000L

/**
 * Whether ONE kept row is PARKED rather than merely PENDING -- the split the age bound rests on, and
 * the reason a clock may retire this row and never another; mirrors the JS drainer's
 * `isSyncDiagnosticsParkedDisposition`.
 *
 * A row is parked when its cause is a MISMATCH between this build and the bridge's version, so no
 * amount of retrying resolves it and only an operator action (a new bridge, or a roll-forward of our
 * own app) does. There are exactly two such causes, and they are this drain's own two parks:
 * - [DiagnosticsPayloadKind.UNCLASSIFIED]: this build does not name the row's `kind`, so the row
 *   belongs to a different build of our own app and rolling forward recovers it;
 * - a `400` that declared NO code: the bridge predates the refusal vocabulary, so its answer names
 *   its own version rather than judging these bytes. That is what this reads the DECLARED code for
 *   -- an empty one already arrived here as `null` from [readDiagnosticsRefusalCode].
 *
 * Everything else that keeps a row is PENDING, and a clock must never destroy it. A transport
 * failure ([verdict] `null`: no verdict at all), a `401`, a `404`, a `405`, a `408`, a `422`, a
 * `429` and every `5xx` are the bridge asking us to come back rather than a judgement about the
 * envelope; and the ONE declared recoverable code is a refusal the bridge DID make, whose own rule
 * is to keep the row and forward-roll it. Reaping any of them by age would lose a backlog on nothing
 * worse than a long outage, which is the opposite of what the bound is for.
 */
internal fun isParkedDiagnosticsRow(
  classification: DiagnosticsPayloadKind,
  verdict: SyncDiagnosticsPostResult?,
): Boolean {
  if (classification == DiagnosticsPayloadKind.UNCLASSIFIED) return true
  return verdict != null && verdict.code == HTTP_BAD_REQUEST && verdict.refusalCode == null
}

/**
 * Whether the age bound should RETIRE one already-kept candidate -- the exact rule behind the
 * `reaped` counter, and the only removal in this pipeline that no verdict and no declaration asked
 * for; mirrors the JS drainer's `shouldReapSyncDiagnosticsParkedRow`.
 *
 * It is a conjunction, and the order is the point: the row must be PARKED before its age is even
 * looked at, so no clock can remove a row whose fate belongs to a verdict (see
 * [isParkedDiagnosticsRow]). The age test is STRICT -- a row is retired once it EXCEEDS the declared
 * bound, never when it merely reaches it, so the bound reads as "how long we wait" rather than "the
 * first instant we can".
 *
 * [rowAgeMs] is computed by the caller (`now - createdAt`) so that a row's age has exactly ONE
 * definition and it lives where the clock does; this module stays pure, with no store and no clock
 * of its own.
 */
internal fun shouldReapParkedDiagnosticsRow(
  classification: DiagnosticsPayloadKind,
  verdict: SyncDiagnosticsPostResult?,
  rowAgeMs: Long,
): Boolean = isParkedDiagnosticsRow(classification, verdict) &&
  rowAgeMs > SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS
