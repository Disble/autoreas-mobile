import {
  ATTEMPT_BACKOFF_JITTER_FRACTION,
  ATTEMPT_BACKOFF_MAX_WAIT_MS,
  ATTEMPT_BACKOFF_STEP_MULTIPLIERS,
  ATTEMPT_POLICY_BASE_INTERVAL_MS,
} from './attempt-policy.constants';
import type {
  AttemptFailureKind,
  AttemptPolicyDecision,
  AttemptPolicySnapshot,
  CreateAttemptPolicyParams,
  SyncAttemptPolicy,
} from './attempt-policy.types';

/**
 * Resolves the capped, pre-jitter backoff wait for one ladder step: the step's base-interval
 * multiple, clamped to `ATTEMPT_BACKOFF_MAX_WAIT_MS` so the longest wait can never exceed 15
 * minutes even if the base interval or the multiplier table grows.
 */
function resolveBackoffWaitMs(stepIndex: number, baseIntervalMs: number): number {
  const multiplier =
    ATTEMPT_BACKOFF_STEP_MULTIPLIERS[stepIndex] ??
    ATTEMPT_BACKOFF_STEP_MULTIPLIERS[ATTEMPT_BACKOFF_STEP_MULTIPLIERS.length - 1];

  return Math.min(multiplier * baseIntervalMs, ATTEMPT_BACKOFF_MAX_WAIT_MS);
}

/**
 * Applies the ±20% jitter to one backoff wait: the injected random value in `[0, 1)` maps
 * linearly onto the factor `[1 - JITTER, 1 + JITTER]` (0 -> shortest, 0.5 -> exact, 1 ->
 * longest), so tests can pin both bounds exactly.
 */
function applyJitter(waitMs: number, random: number): number {
  const factor = 1 - ATTEMPT_BACKOFF_JITTER_FRACTION + 2 * ATTEMPT_BACKOFF_JITTER_FRACTION * random;

  return Math.round(waitMs * factor);
}

/**
 * Creates the pure, dependency-injected attempt policy for the foreground sync cadence (T6).
 *
 * The policy owns two things the measured device evidence demanded:
 * 1. The in-flight guard -- while a probe or cycle is pending, every new tick is refused, so the
 *    interval ticker can never pile up attempts faster than they finish.
 * 2. The absent-bridge backoff ladder -- after a presence probe that got no HTTP answer, the
 *    next attempts are pushed out on the doubling `1, 2, 4, 8` ladder of base-interval
 *    multiples (capped at 15 minutes, ±20% jitter), resetting to the shortest wait on the first
 *    success. A bridge that answers with an HTTP status (even 4xx) is present and never
 *    lengthens the ladder.
 *
 * Everything impure (clock, randomness, the presence probe itself) is injected, so the policy
 * is unit-testable with no timers and no I/O.
 */
export function createAttemptPolicy(
  params: CreateAttemptPolicyParams,
): SyncAttemptPolicy {
  const random = params.random ?? Math.random;
  const baseIntervalMs = params.baseIntervalMs ?? ATTEMPT_POLICY_BASE_INTERVAL_MS;

  let stepIndex = 0;
  let inFlight = false;
  let nextAttemptAllowedAt = 0;
  let lastAppliedWaitMs: number | null = null;

  function getSnapshot(): AttemptPolicySnapshot {
    const multiplier =
      ATTEMPT_BACKOFF_STEP_MULTIPLIERS[stepIndex] ??
      ATTEMPT_BACKOFF_STEP_MULTIPLIERS[ATTEMPT_BACKOFF_STEP_MULTIPLIERS.length - 1];

    return {
      stepIndex,
      multiplier,
      waitMs: resolveBackoffWaitMs(stepIndex, baseIntervalMs),
      lastAppliedWaitMs,
    };
  }

  /**
   * Closes one attempt and applies the failure consequence. Only `probe_absent` advances the
   * ladder: the wait is taken from the CURRENT step (first failure waits one base interval),
   * then the step index moves toward the last multiplier. `cycle_failed` only clears the
   * in-flight guard -- the probe already proved the bridge present, so the cadence must not
   * punish an operation-level rejection.
   */
  function recordFailure(kind: AttemptFailureKind) {
    inFlight = false;

    if (kind !== 'probe_absent') {
      return;
    }

    lastAppliedWaitMs = applyJitter(resolveBackoffWaitMs(stepIndex, baseIntervalMs), random());
    nextAttemptAllowedAt = params.now() + lastAppliedWaitMs;
    stepIndex = Math.min(stepIndex + 1, ATTEMPT_BACKOFF_STEP_MULTIPLIERS.length - 1);
  }

  async function shouldAttemptTick(): Promise<AttemptPolicyDecision> {
    if (inFlight) {
      return { shouldAttempt: false, reason: 'in_flight' };
    }

    const currentNow = params.now();
    if (currentNow < nextAttemptAllowedAt) {
      return {
        shouldAttempt: false,
        reason: 'backoff_waiting',
        remainingWaitMs: nextAttemptAllowedAt - currentNow,
      };
    }

    // The probe is part of the attempt: mark in-flight BEFORE awaiting it so ticks arriving
    // while the probe is pending cannot start a second concurrent attempt.
    inFlight = true;
    const isPresent = await params.probePresence();

    if (!isPresent) {
      recordFailure('probe_absent');
      return { shouldAttempt: false, reason: 'bridge_absent' };
    }

    return { shouldAttempt: true, reason: 'bridge_present' };
  }

  return {
    shouldAttemptTick,
    recordSuccess() {
      inFlight = false;
      stepIndex = 0;
      nextAttemptAllowedAt = 0;
    },
    recordFailure,
    getSnapshot,
  };
}
