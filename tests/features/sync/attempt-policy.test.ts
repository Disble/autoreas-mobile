import { createAttemptPolicy } from '../../../src/features/sync/attempt-policy.helpers';
import {
  ATTEMPT_BACKOFF_MAX_WAIT_MS,
  ATTEMPT_PROBE_DEADLINE_MS,
} from '../../../src/features/sync/attempt-policy.constants';
import type { AttemptPolicyDecision } from '../../../src/features/sync/attempt-policy.types';

/** Neutral jitter source: 0.5 maps to the exact 1.0 factor, so waits are deterministic. */
const NEUTRAL_RANDOM = () => 0.5;

describe('attempt-policy', () => {
  function createHarness(overrides: {
    probePresence?: () => Promise<boolean>;
    random?: () => number;
    baseIntervalMs?: number;
  } = {}) {
    let currentTime = 0;
    const probeCalls: number[] = [];

    const probePresence =
      overrides.probePresence ?? jest.fn(async () => false);

    const policy = createAttemptPolicy({
      probePresence: () => {
        probeCalls.push(currentTime);
        return probePresence();
      },
      now: () => currentTime,
      random: overrides.random ?? NEUTRAL_RANDOM,
      ...(overrides.baseIntervalMs !== undefined
        ? { baseIntervalMs: overrides.baseIntervalMs }
        : {}),
    });

    return {
      policy,
      probeCalls,
      advanceTo: (ms: number) => {
        currentTime = ms;
      },
    };
  }

  async function failProbe(harness: ReturnType<typeof createHarness>) {
    const decision = await harness.policy.shouldAttemptTick();
    return decision;
  }

  it('approves the first tick after probing presence, and the probe is part of the attempt', async () => {
    const harness = createHarness({ probePresence: jest.fn(async () => true) });

    const decision = await harness.policy.shouldAttemptTick();

    expect(decision).toEqual<AttemptPolicyDecision>({
      shouldAttempt: true,
      reason: 'bridge_present',
    });
    expect(harness.probeCalls).toEqual([0]);
  });

  it('refuses the attempt when the bridge is absent (any transport failure)', async () => {
    const harness = createHarness({ probePresence: jest.fn(async () => false) });

    const decision = await harness.policy.shouldAttemptTick();

    expect(decision).toEqual<AttemptPolicyDecision>({
      shouldAttempt: false,
      reason: 'bridge_absent',
    });
  });

  it('walks the doubling ladder 1, 2, 4, 8 (x the base interval) across consecutive failures', async () => {
    const harness = createHarness();

    // Fresh policy: step 0, wait one base interval on the first failure.
    expect(harness.policy.getSnapshot()).toMatchObject({ stepIndex: 0, multiplier: 1, waitMs: 60_000 });

    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({
      stepIndex: 1,
      multiplier: 2,
      waitMs: 120_000,
      lastAppliedWaitMs: 60_000,
    });

    harness.advanceTo(60_000);
    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({
      stepIndex: 2,
      waitMs: 240_000,
      lastAppliedWaitMs: 120_000,
    });

    harness.advanceTo(180_000);
    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({
      stepIndex: 3,
      waitMs: 480_000,
      lastAppliedWaitMs: 240_000,
    });

    harness.advanceTo(420_000);
    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({
      stepIndex: 3,
      multiplier: 8,
      waitMs: 480_000,
      lastAppliedWaitMs: 480_000,
    });

    // The ladder never grows past its last multiplier (8).
    harness.advanceTo(900_000);
    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({ stepIndex: 3, lastAppliedWaitMs: 480_000 });
  });

  it('caps any single backoff wait at 15 minutes', async () => {
    // A 5-minute base makes multipliers 1,2,4 produce 5m,10m,20m waits; the cap clamps at 15m.
    const harness = createHarness({ baseIntervalMs: 300_000 });

    expect(harness.policy.getSnapshot()).toMatchObject({ waitMs: 300_000 });

    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({ waitMs: 600_000 });

    harness.advanceTo(300_000);
    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({ waitMs: ATTEMPT_BACKOFF_MAX_WAIT_MS });

    harness.advanceTo(1_200_000);
    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({
      waitMs: ATTEMPT_BACKOFF_MAX_WAIT_MS,
      lastAppliedWaitMs: ATTEMPT_BACKOFF_MAX_WAIT_MS,
    });
  });

  it('applies ±20% jitter, pinned exactly by the injected random source', async () => {
    // random=0 -> factor 0.8; random=1 -> factor 1.2; anything between is linear.
    for (const [random, expectedWait] of [
      [0, 48_000],
      [0.5, 60_000],
      [1, 72_000],
    ] as const) {
      const harness = createHarness({ random: () => random });

      await failProbe(harness);

      expect(harness.policy.getSnapshot().lastAppliedWaitMs).toBe(expectedWait);
    }

    // Every reachable random value stays inside the ±20% bounds.
    for (let i = 0; i <= 20; i += 1) {
      const harness = createHarness({ random: () => i / 20 });

      await failProbe(harness);

      const applied = harness.policy.getSnapshot().lastAppliedWaitMs;
      expect(applied).toBeGreaterThanOrEqual(48_000);
      expect(applied).toBeLessThanOrEqual(72_000);
    }
  });

  it('refuses ticks while the backoff window is open, with the remaining wait observable', async () => {
    const harness = createHarness({ probePresence: jest.fn(async () => false) });

    await failProbe(harness);
    const probeCount = harness.probeCalls.length;

    harness.advanceTo(60_000 - 1);
    const waiting = await harness.policy.shouldAttemptTick();

    expect(waiting).toEqual<AttemptPolicyDecision>({
      shouldAttempt: false,
      reason: 'backoff_waiting',
      remainingWaitMs: 1,
    });
    // The probe is NOT re-fired while backing off -- that is the whole point of the ladder.
    expect(harness.probeCalls.length).toBe(probeCount);

    harness.advanceTo(60_000);
    const due = await harness.policy.shouldAttemptTick();
    expect(due.shouldAttempt).toBe(false);
    expect(due.reason).toBe('bridge_absent');
    expect(harness.probeCalls.length).toBe(probeCount + 1);
  });

  it('resets to the shortest wait on the first success', async () => {
    const harness = createHarness();

    await failProbe(harness);
    harness.advanceTo(60_000);
    await failProbe(harness);
    expect(harness.policy.getSnapshot()).toMatchObject({ stepIndex: 2, waitMs: 240_000 });

    harness.policy.recordSuccess();

    expect(harness.policy.getSnapshot()).toMatchObject({ stepIndex: 0, multiplier: 1, waitMs: 60_000 });

    // The next failure waits the shortest ladder wait again (1 x base interval).
    const decision = await failProbe(harness);
    expect(harness.policy.getSnapshot().lastAppliedWaitMs).toBe(60_000);
    expect(decision.reason).toBe('bridge_absent');
  });

  it('does not lengthen the ladder when the bridge answers but rejects the operation (4xx)', async () => {
    // A 401/403/404 from the probe is PRESENCE: the policy only sees `true`.
    const harness = createHarness({ probePresence: jest.fn(async () => true) });

    await harness.policy.shouldAttemptTick();
    expect(harness.policy.getSnapshot()).toMatchObject({ stepIndex: 0 });

    // Cycle failures after a present bridge only clear the in-flight guard.
    harness.policy.recordFailure('cycle_failed');
    harness.policy.recordFailure('cycle_failed');
    harness.policy.recordFailure('cycle_failed');

    expect(harness.policy.getSnapshot()).toMatchObject({
      stepIndex: 0,
      multiplier: 1,
      waitMs: 60_000,
      lastAppliedWaitMs: null,
    });

    // And no backoff window opened: the very next tick is probed and approved again.
    const next = await harness.policy.shouldAttemptTick();
    expect(next).toEqual<AttemptPolicyDecision>({ shouldAttempt: true, reason: 'bridge_present' });
  });

  it('an explicit probe_absent failure advances the ladder by one step per failure', async () => {
    const harness = createHarness();

    harness.policy.recordFailure('probe_absent');
    harness.policy.recordFailure('probe_absent');

    expect(harness.policy.getSnapshot()).toMatchObject({
      stepIndex: 2,
      waitMs: 240_000,
      lastAppliedWaitMs: 120_000,
    });
  });

  it('blocks a second attempt while one is in flight (the probe itself counts)', async () => {
    let releaseProbe!: (present: boolean) => void;
    let probeReleased = false;
    const harness = createHarness({
      probePresence: () => {
        if (probeReleased) {
          return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
          releaseProbe = (present: boolean) => {
            probeReleased = true;
            resolve(present);
          };
        });
      },
    });

    const firstTick = harness.policy.shouldAttemptTick();

    // A tick arriving while the probe (or the approved cycle) is pending is refused outright.
    const secondTick = await harness.policy.shouldAttemptTick();
    expect(secondTick).toEqual<AttemptPolicyDecision>({
      shouldAttempt: false,
      reason: 'in_flight',
    });

    releaseProbe(true);
    expect(await firstTick).toEqual<AttemptPolicyDecision>({
      shouldAttempt: true,
      reason: 'bridge_present',
    });

    // Still in flight until the runner reports the outcome.
    const thirdTick = await harness.policy.shouldAttemptTick();
    expect(thirdTick.reason).toBe('in_flight');

    harness.policy.recordSuccess();
    const fourthTick = await harness.policy.shouldAttemptTick();
    expect(fourthTick.shouldAttempt).toBe(true);
  });

  it('documents the 1500 ms probe budget the adapter must pass to getStatus', () => {
    // The no-op acceptance bound is 2 s: the probe deadline is the dominant term of a skipped
    // tick, so it must stay at 1500 ms. The adapter owns passing it as the getStatus override.
    expect(ATTEMPT_PROBE_DEADLINE_MS).toBe(1500);
  });
});
