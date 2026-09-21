import { FOREGROUND_SYNC_INTERVAL_MS } from './notifee-foreground-service-adapter/notifee-foreground-service-adapter.constants';

/**
 * Absent-bridge backoff ladder, expressed in base-interval multiples (T6). After each failed
 * presence probe the policy skips ticks on this doubling ladder and never grows past the last
 * entry; the 15-minute ceiling below clamps the absolute wait.
 */
export const ATTEMPT_BACKOFF_STEP_MULTIPLIERS = [1, 2, 4, 8] as const;

/**
 * Upper bound on any single backoff wait (15 minutes). With the 60 s base interval the ladder
 * tops out at 8 x 60 s = 8 minutes, so the cap is a safety ceiling that only binds if the base
 * interval or the ladder ever grows; without it, one bad multiplier would silently turn the
 * cadence into a quarter-hour radio silence.
 */
export const ATTEMPT_BACKOFF_MAX_WAIT_MS = 15 * 60_000;

/**
 * Relative half-width of the backoff jitter. Each wait is multiplied by a factor in
 * `[1 - 0.2, 1 + 0.2]` derived from the injected random source, so simultaneous devices that
 * failed at the same moment do not re-align their probes on every ladder step.
 */
export const ATTEMPT_BACKOFF_JITTER_FRACTION = 0.2;

/**
 * Default base interval the ladder multipliers apply to: the honest foreground cadence (T6 owns
 * `FOREGROUND_SYNC_INTERVAL_MS`, see notifee-foreground-service-adapter.constants.ts for why it
 * is 60 s). Injectable per policy via `CreateAttemptPolicyParams.baseIntervalMs`.
 */
export const ATTEMPT_POLICY_BASE_INTERVAL_MS = FOREGROUND_SYNC_INTERVAL_MS;

/**
 * Presence-probe budget in milliseconds (T6). The adapter passes this as the `getStatus`
 * `timeoutMs` override; together with the tick overhead it keeps a skipped tick well under the
 * 2 s no-op acceptance bound (the measured failure mode was 10 s per absent-bridge attempt).
 */
export const ATTEMPT_PROBE_DEADLINE_MS = 1500;
