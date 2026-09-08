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
