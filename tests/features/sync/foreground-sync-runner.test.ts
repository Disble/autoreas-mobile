import { createForegroundSyncRunner } from '../../../src/features/sync/foreground-sync-runner.helpers';
import type { ForegroundSyncTicker } from '../../../src/features/sync/native-foreground-sync-ticker.types';
import type {
  AttemptPolicyDecision,
  SyncAttemptPolicy,
} from '../../../src/features/sync/attempt-policy.types';

describe('foreground-sync-runner', () => {
  function createFakeTicker() {
    const listeners = new Set<() => void | Promise<void>>();

    const ticker: ForegroundSyncTicker = {
      start: jest.fn(),
      stop: jest.fn(),
      onTick: jest.fn((callback: () => void | Promise<void>) => {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      }),
      isRunning: jest.fn().mockReturnValue(true),
    };

    return {
      ticker,
      fireTick: () => {
        listeners.forEach((listener) => listener());
      },
      listenerCount: () => listeners.size,
    };
  }

  it('subscribes to ticker ticks and runs one cycle per tick', async () => {
    const { ticker, fireTick } = createFakeTicker();
    const runCycle = jest.fn().mockResolvedValue(undefined);
    const onCycleError = jest.fn();

    const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError });
    const servicePromise = runner.start();

    expect(runner.isRunning()).toBe(true);
    expect(runCycle).not.toHaveBeenCalled();

    fireTick();
    await Promise.resolve();
    expect(runCycle).toHaveBeenCalledTimes(1);

    fireTick();
    await Promise.resolve();
    expect(runCycle).toHaveBeenCalledTimes(2);

    await runner.stop();
    await servicePromise;

    expect(runner.isRunning()).toBe(false);
  });

  it('does not start a second subscription when start is called twice while already running', () => {
    const { ticker } = createFakeTicker();
    const runCycle = jest.fn().mockResolvedValue(undefined);
    const onCycleError = jest.fn();

    const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError });

    const firstPromise = runner.start();
    const secondPromise = runner.start();

    expect(secondPromise).toBe(firstPromise);
    expect(ticker.onTick).toHaveBeenCalledTimes(1);
  });

  it('the start promise stays pending until stop is called (Notifee foreground-service contract)', async () => {
    const { ticker } = createFakeTicker();
    const runner = createForegroundSyncRunner({
      ticker,
      runCycle: jest.fn().mockResolvedValue(undefined),
      onCycleError: jest.fn(),
    });

    let settled = false;
    const servicePromise = runner.start().then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    await runner.stop();
    await servicePromise;

    expect(settled).toBe(true);
  });

  it('routes cycle errors to onCycleError instead of swallowing them', async () => {
    const { ticker, fireTick } = createFakeTicker();
    const runCycle = jest.fn().mockRejectedValue(new Error('boom'));
    const onCycleError = jest.fn();

    const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError });
    const servicePromise = runner.start();

    fireTick();
    await Promise.resolve();
    await Promise.resolve();

    expect(onCycleError).toHaveBeenCalledTimes(1);
    expect(onCycleError).toHaveBeenCalledWith(expect.any(Error));

    // The runner keeps subscribing after a failed cycle -- the next tick still runs.
    fireTick();
    await Promise.resolve();
    await Promise.resolve();
    expect(runCycle).toHaveBeenCalledTimes(2);

    await runner.stop();
    await servicePromise;
  });

  it('unsubscribes from the ticker after stop so late ticks are ignored', async () => {
    const { ticker, fireTick, listenerCount } = createFakeTicker();
    const runCycle = jest.fn().mockResolvedValue(undefined);

    const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError: jest.fn() });
    const servicePromise = runner.start();

    expect(listenerCount()).toBe(1);

    await runner.stop();
    await servicePromise;

    expect(listenerCount()).toBe(0);

    fireTick();
    await Promise.resolve();

    expect(runCycle).not.toHaveBeenCalled();
  });

  it('returns the cycle promise to the ticker so the wake lock can be scoped to the cycle', async () => {
    const { ticker } = createFakeTicker();
    let resolveRunCycle!: () => void;
    const runCycle = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRunCycle = resolve;
        }),
    );

    const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError: jest.fn() });
    const servicePromise = runner.start();

    // The runner must hand its cycle promise back to the tick callback: the native ticker
    // releases the per-cycle wake lock only when that promise settles. A discarded promise
    // would leave the lock's lifetime undefined (safety-net timeout only).
    const tickCallback = (ticker.onTick as jest.Mock).mock.calls[0]?.[0] as () => Promise<void>;
    const cyclePromise = tickCallback();
    expect(cyclePromise).toBeInstanceOf(Promise);

    resolveRunCycle();
    await expect(cyclePromise).resolves.toBeUndefined();
    expect(runCycle).toHaveBeenCalledTimes(1);

    await runner.stop();
    await servicePromise;
  });

  it('does not call ticker.start/stop -- ticker lifecycle is owned by the caller', async () => {
    const { ticker } = createFakeTicker();
    const runner = createForegroundSyncRunner({
      ticker,
      runCycle: jest.fn().mockResolvedValue(undefined),
      onCycleError: jest.fn(),
    });

    const servicePromise = runner.start();
    await runner.stop();
    await servicePromise;

    expect(ticker.start).not.toHaveBeenCalled();
    expect(ticker.stop).not.toHaveBeenCalled();
  });

  describe('with an attempt policy (T6)', () => {
    function createFakePolicy(defaultDecision: AttemptPolicyDecision): SyncAttemptPolicy {
      return {
        shouldAttemptTick: jest.fn(async () => defaultDecision),
        recordSuccess: jest.fn(),
        recordFailure: jest.fn(),
        getSnapshot: jest.fn(),
      };
    }

    it('consults the policy before every tick and skips the cycle when it refuses', async () => {
      const { ticker, fireTick } = createFakeTicker();
      const runCycle = jest.fn().mockResolvedValue(undefined);
      const policy = createFakePolicy({ shouldAttempt: false, reason: 'bridge_absent' });

      const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError: jest.fn(), attemptPolicy: policy });
      const servicePromise = runner.start();

      fireTick();
      await Promise.resolve();
      await Promise.resolve();

      expect(policy.shouldAttemptTick).toHaveBeenCalledTimes(1);
      expect(runCycle).not.toHaveBeenCalled();
      expect(policy.recordSuccess).not.toHaveBeenCalled();
      expect(policy.recordFailure).not.toHaveBeenCalled();

      await runner.stop();
      await servicePromise;
    });

    it('a skipped tick promise settles immediately, so the wake lock is released at once', async () => {
      const { ticker } = createFakeTicker();
      const policy = createFakePolicy({ shouldAttempt: false, reason: 'in_flight' });

      const runner = createForegroundSyncRunner({
        ticker,
        runCycle: jest.fn().mockResolvedValue(undefined),
        onCycleError: jest.fn(),
        attemptPolicy: policy,
      });
      const servicePromise = runner.start();

      // The native ticker releases its per-cycle wake lock when the returned promise settles;
      // a refused tick must therefore resolve without awaiting any cycle work.
      const tickCallback = (ticker.onTick as jest.Mock).mock.calls[0]?.[0] as () => Promise<void>;
      await expect(tickCallback()).resolves.toBeUndefined();

      await runner.stop();
      await servicePromise;
    });

    it('runs the cycle when the policy approves and reports the success back', async () => {
      const { ticker, fireTick } = createFakeTicker();
      const runCycle = jest.fn().mockResolvedValue(undefined);
      const policy = createFakePolicy({ shouldAttempt: true, reason: 'bridge_present' });

      const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError: jest.fn(), attemptPolicy: policy });
      const servicePromise = runner.start();

      fireTick();
      await Promise.resolve();
      await Promise.resolve();

      expect(runCycle).toHaveBeenCalledTimes(1);
      expect(policy.recordSuccess).toHaveBeenCalledTimes(1);
      expect(policy.recordFailure).not.toHaveBeenCalled();

      await runner.stop();
      await servicePromise;
    });

    it('reports cycle_failed (never ladder-advancing) and routes the error when the cycle rejects', async () => {
      const { ticker, fireTick } = createFakeTicker();
      const runCycle = jest.fn().mockRejectedValue(new Error('boom'));
      const onCycleError = jest.fn();
      const policy = createFakePolicy({ shouldAttempt: true, reason: 'bridge_present' });

      const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError, attemptPolicy: policy });
      const servicePromise = runner.start();

      fireTick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(onCycleError).toHaveBeenCalledWith(expect.any(Error));
      // The probe already proved the bridge present, so a cycle failure must NOT advance the
      // backoff ladder -- only clear the in-flight guard.
      expect(policy.recordFailure).toHaveBeenCalledWith('cycle_failed');
      expect(policy.recordSuccess).not.toHaveBeenCalled();

      await runner.stop();
      await servicePromise;
    });

    it('still returns the cycle promise to the ticker when the policy approves (T11 intact)', async () => {
      const { ticker } = createFakeTicker();
      let resolveRunCycle!: () => void;
      const runCycle = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveRunCycle = resolve;
          }),
      );
      const policy = createFakePolicy({ shouldAttempt: true, reason: 'bridge_present' });

      const runner = createForegroundSyncRunner({ ticker, runCycle, onCycleError: jest.fn(), attemptPolicy: policy });
      const servicePromise = runner.start();

      const tickCallback = (ticker.onTick as jest.Mock).mock.calls[0]?.[0] as () => Promise<void>;
      const cyclePromise = tickCallback();
      expect(cyclePromise).toBeInstanceOf(Promise);

      // The policy consultation is awaited before the cycle starts; flush it.
      await Promise.resolve();

      resolveRunCycle();
      await expect(cyclePromise).resolves.toBeUndefined();
      expect(policy.recordSuccess).toHaveBeenCalledTimes(1);

      await runner.stop();
      await servicePromise;
    });
  });
});
