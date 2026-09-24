/**
 * Every diagnostic body `kind` the bridge currently accepts at `POST /api/sync/diagnostics`.
 *
 * The bridge strict-decodes that body with `DisallowUnknownFields()` and answers 400 for a key it
 * does not declare, and this app's flush reads a 400 as "this envelope is malformed forever" and
 * deletes the row client-side. A kind missing from this list is therefore not merely undelivered:
 * it is destroyed on its first attempt. This list is the ONE source of truth for "may this body be
 * posted at all", consulted by the chapter recorder before it enqueues and by the flush before it
 * POSTs.
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
 */
export const SYNC_DIAGNOSTICS_ACCEPTED_KINDS = [undefined] as const;

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
