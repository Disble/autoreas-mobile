/**
 * Why one attempt ended, as reported by the sync runner back into the attempt policy. The kind
 * decides whether the backoff ladder advances: only `probe_absent` (the bridge answered with no
 * HTTP response at all) does. Any bridge that answers with an HTTP status -- including a 4xx
 * operation rejection -- is present, so it must never lengthen the ladder; per-operation
 * rejection is `dead_letter`'s business, not the cadence's.
 */
export type AttemptFailureKind =
  /** The presence probe got no HTTP answer (transport failure, abort, or timeout). */
  | 'probe_absent'
  /** The cycle itself failed after the bridge was proven present by the probe. */
  | 'cycle_failed';

/** Why the attempt policy refused to start an attempt on one tick. */
export type AttemptSkipReason =
  /** A previous attempt (probe or cycle) is still in flight; a new tick must not pile up. */
  | 'in_flight'
  /** The last absent-bridge failure scheduled the next attempt in the future. */
  | 'backoff_waiting'
  /** The presence probe got no HTTP answer, so this tick must not run a cycle. */
  | 'bridge_absent';

/** Outcome of consulting the attempt policy on one tick. */
export interface AttemptPolicyDecision {
  /** Whether the runner should run a full sync cycle on this tick. */
  readonly shouldAttempt: boolean;
  /** `bridge_present` when the attempt is approved; otherwise why the tick was skipped. */
  readonly reason: AttemptSkipReason | 'bridge_present';
  /**
   * Milliseconds until the next attempt is allowed, when `reason` is `backoff_waiting`. Lets a
   * test (or caller) observe the backoff without sleeping.
   */
  readonly remainingWaitMs?: number;
}

/** Observable ladder state, exposed so tests can assert backoff without sleeping. */
export interface AttemptPolicySnapshot {
  /** Index into the ladder multiplier table the NEXT failure will apply. */
  readonly stepIndex: number;
  /** Base-interval multiple the next failure will wait (`1`, `2`, `4`, or `8`). */
  readonly multiplier: number;
  /** Capped, pre-jitter wait the next failure would schedule. */
  readonly waitMs: number;
  /** Jittered wait actually applied after the last absent-bridge failure, or null if none yet. */
  readonly lastAppliedWaitMs: number | null;
}

/** Injectable collaborators for the attempt policy: no timers, no I/O of its own. */
export interface CreateAttemptPolicyParams {
  /**
   * Cheap presence probe. Must resolve `true` when the bridge answered with ANY HTTP response
   * (including 401/403/404) and `false` only on transport failure, abort, or timeout. The
   * production probe is `BridgeClient.getStatus(connection, { timeoutMs: 1500 })`.
   */
  readonly probePresence: () => Promise<boolean>;
  /** Monotonic-enough clock in milliseconds (production: `Date.now()`); injected for tests. */
  readonly now: () => number;
  /**
   * Random source for backoff jitter, returning a value in `[0, 1)` (production: `Math.random`);
   * injected so tests can pin the jitter to its exact bounds.
   */
  readonly random?: () => number;
  /**
   * Base interval in milliseconds the ladder multipliers apply to. Defaults to
   * `FOREGROUND_SYNC_INTERVAL_MS` (T6 owns that value); injectable so tests can exercise the
   * 15-minute cap with a larger base.
   */
  readonly baseIntervalMs?: number;
}

/**
 * Pure, dependency-injected attempt policy for the foreground sync cadence (T6). Owns the
 * in-flight guard and the absent-bridge backoff ladder; the runner consults it before every
 * cycle and reports each attempt's outcome back through `recordSuccess` / `recordFailure`.
 */
export interface SyncAttemptPolicy {
  /**
   * Consults the policy for one tick. Skips synchronously when an attempt is in flight or the
   * backoff has not elapsed; otherwise probes presence (awaited) and approves the attempt only
   * when the bridge answered. While an approved attempt is pending, `in_flight` guards every
   * later tick until `recordSuccess` / `recordFailure` reports the outcome.
   */
  readonly shouldAttemptTick: () => Promise<AttemptPolicyDecision>;
  /** Reports a completed successful attempt: clears in-flight and resets the ladder to step 0. */
  readonly recordSuccess: () => void;
  /**
   * Reports a failed attempt. Only `probe_absent` advances the backoff ladder; `cycle_failed`
   * merely clears the in-flight guard because the bridge was already proven present.
   */
  readonly recordFailure: (kind: AttemptFailureKind) => void;
  /** Returns the current ladder state for observation (tests assert on it without sleeping). */
  readonly getSnapshot: () => AttemptPolicySnapshot;
}
