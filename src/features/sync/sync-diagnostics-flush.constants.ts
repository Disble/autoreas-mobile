/**
 * Every diagnostic body `kind` the bridge currently accepts at `POST /api/sync/diagnostics`.
 *
 * The bridge strict-decodes that body with `DisallowUnknownFields()` and answers 400 for a key it
 * does not declare, and this app's flush reads a 400 that DECLARES a code as "this envelope is
 * malformed forever" and deletes the row client-side. A kind missing from this list that reaches the
 * wire is therefore not merely undelivered: it is destroyed on its first attempt. This list is the
 * ONE source of truth for "may this body be posted at all", consulted by the chapter recorder before
 * it enqueues and by the flush before it POSTs.
 *
 * The single `undefined` entry IS the legacy sync-cycle envelope. The bridge identifies a cycle
 * report by the ABSENCE of a `kind` key -- a frozen backward-compatibility rule, because deployed
 * mobile builds send no `kind` -- and an absent key reads as `undefined`. JSON cannot represent
 * `undefined`, so no body that declares a real kind (not even an explicit `null`) can match that
 * entry: it identifies absence itself, not any value a payload could carry.
 *
 * When the bridge ships `episode_action`, adding that token here -- and nothing else, anywhere --
 * is the whole change that lets observations flow again: the recorder starts enqueuing and the
 * flush starts posting them off this same list. There is deliberately no feature flag, preference
 * or build-time constant to remember in addition to it.
 *
 * A body this predicate REFUSES is not thereby destroyed: the flush's classifier parks it as
 * `unclassified` unless its kind is positively declared in `SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS`.
 * "Not accepted" and "destroyed" are two different judgements and only the second one loses data.
 */
export const SYNC_DIAGNOSTICS_ACCEPTED_KINDS = [undefined] as const;

/**
 * Every diagnostic body `kind` this build KNOWS the bridge does not accept and never will -- the ONE
 * leg that authorizes destroying a stored row without asking the bridge.
 *
 * EMPTY, and legitimately so (odd/tasks/chapter-action-diagnostics.md): destruction requires a
 * positive declaration that the bridge refuses that kind forever, and "not currently in the
 * accepted registry" is not one. An app rollback produces exactly such rows, and rolling forward is
 * what recovers them -- so inferring destruction from registry absence would turn a recoverable
 * registry mistake into an irreversible loss of the rolled-back build's whole backlog.
 *
 * A kind no build will ever accept parks forever instead, and is recovered through this same door:
 * an operator moves it here. That is why the set can be empty and still be complete.
 */
export const SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS: readonly string[] = [];

/**
 * The bridge's ONE recoverable refusal code: `kind_not_served`, a member of the `RefusalCode`
 * vocabulary its handler rides on every refusal of `POST /api/sync/diagnostics`.
 *
 * It is recoverable because the bytes are NOT wrong: the build behind the bridge simply does not
 * serve that kind. Forward-rolling to a bridge that does serve it accepts every one of these rows
 * UNCHANGED, so the row is kept and the batch stops instead of being destroyed -- discarding them
 * would destroy a backlog a later bridge would have taken as it stands.
 *
 * The branch it drives is the difference between a status list and a vocabulary. A client that kept
 * a status list per refusal class would have to be re-released every time the bridge grew a member;
 * this ONE member is read from the refusal's own declared field (`readSyncDiagnosticsRefusalCode`),
 * which is the property that made the discriminated contract worth adopting. Every other member --
 * `kind_malformed`, `body_unreadable`, `field_rejected`, `body_too_large`, `ingest_unavailable`,
 * `write_budget_exceeded`, `internal_error`, `method_not_allowed` -- keeps the verdict its status
 * already declared: those bytes are refused by every build there will ever be.
 *
 * A refusal that declares NO code is NOT this value and NOT a recoverable refusal: `401` is written
 * by the shared authentication layer, not by the handler, so nothing was declared and the status
 * answers. A `400` declaring no code is answered by its status too, but its status is no longer a
 * destruction verdict: it is a VERSION state -- a bridge older than this vocabulary -- so the row is
 * kept and the batch stops. Growing this vocabulary is a bridge contract change, never a local
 * judgement call.
 */
export const SYNC_DIAGNOSTICS_RECOVERABLE_REFUSAL_CODE = 'kind_not_served';

/**
 * Number of oldest eligible diagnostics outbox entries attempted per sync cycle.
 *
 * Bounded by the timing chain (design.md): `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE *
 * SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS + BRIDGE_REQUEST_TIMEOUT_MS` must stay comfortably under
 * `BACKGROUND_SYNC_CYCLE_DEADLINE_MS`, or instrumentation kills the cycle it instruments. Every
 * sync trigger is a flush opportunity, so throughput comes from cadence, not batch size: the
 * foreground ticker alone drains a full 100-row backlog in about 8 minutes.
 */
export const SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE = 3;

/**
 * Per-request budget for one diagnostics POST, passed via `BridgeRequestSpec.timeoutMs`.
 * Deliberately smaller than `BRIDGE_REQUEST_TIMEOUT_MS`: a diagnostics POST must never cost
 * what the reconcile POST it accompanies costs -- the primary work keeps the larger budget.
 */
export const SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000;

/**
 * How long a PARKED row stays in the outbox before a drain gives up on it and REAPS it -- the one
 * clock this pipeline has, and the only thing besides the bridge's own verdict that may remove a
 * stored row.
 *
 * A PARK is a mismatch between this build and the bridge's version, and nothing this app does on
 * its own resolves it: either the row's `kind` is one this build does not name (a different build
 * of our own app wrote it, which a roll-forward recovers), or the bridge answered a `400` that
 * declared NO code (it predates the refusal vocabulary, so it never judged these bytes). Both park
 * the row at the HEAD of an oldest-first queue, and the outbox cap sheds the TAIL -- so while the
 * mismatch lasts the retained window fills with never-drainable rows and the telemetry that WOULD
 * have delivered is what gets shed. The bound is what turns that indefinite stall into a bounded
 * wait, and `reaped` is the operator signal that it expired.
 *
 * ONE WEEK, for three reasons. (1) It is measured against the OPERATOR's response, not against any
 * retry cadence: every cadence the app owns is seconds-to-minutes (the background floor is 15 min,
 * a cycle budget 45 s, the not-before gate 5 s), and none of them can change the version on either
 * side, so the real question is how long a person takes to install the bridge or roll the app
 * forward -- days. (2) The row is the ONLY copy from the moment it is captured, so the wait has to
 * cover at least one plausible human response cycle rather than the first convenient sweep.
 * (3) It is a REAL bound rather than a longer stall: the retained window is at most
 * `SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS` (100) rows and a pass retires up to
 * `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE` (3) of them, so a saturated window retires in at most 34
 * passes -- well under a day at the background floor -- while a transport outage NEVER reaches this
 * bound at all, because a row the bridge never answered about is PENDING and no clock may destroy
 * it.
 *
 * No UI reads this: it is a drainer-side bound whose only observable is the persisted `reaped`
 * counter. Raising it lengthens the stall; lowering it destroys rows a slower operator would have
 * recovered.
 */
export const SYNC_DIAGNOSTICS_PARKED_ROW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * The wait applied to a `503` that declares no usable `Retry-After`; mirrors the native drainer's
 * `SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS`.
 *
 * `503` is the bridge's OWN backpressure status, and its contract is "503 with `Retry-After: 5`".
 * The bridge has TWO `503` paths and only the write-budget shed sends the header -- the
 * ingestion-unavailable path sends none -- so a header-less `503` is the same declaration with the
 * header lost or stripped in transit (a proxy in front of the bridge is the usual reason), not a
 * different verdict about our bytes. Deferring by the bridge's declared wait is therefore the
 * honest reading and the difference between a one-cycle stall and a hot loop against a bridge that
 * is already asking for room.
 *
 * Scoped to `503` ALONE: the other retryable verdicts (`401`, `404`, `408`, `422`, `429`, `500`, a
 * transport failure) declare no wait at all, so inventing one there would be a backoff this app
 * made up rather than one the bridge asked for. Those stop the batch with no gate, which is exactly
 * what the trigger cadence is for.
 */
export const SYNC_DIAGNOSTICS_UNAVAILABLE_RETRY_AFTER_MS = 5_000;
