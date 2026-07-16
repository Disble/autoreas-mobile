import { createForegroundSyncRunner } from '../../../src/features/sync/foreground-sync-runner.helpers';
import type { ForegroundSyncTicker } from '../../../src/features/sync/native-foreground-sync-ticker.types';

describe('foreground-sync-runner', () => {
  function createFakeTicker() {
    const listeners = new Set<() => void>();

    const ticker: ForegroundSyncTicker = {
      start: jest.fn(),
      stop: jest.fn(),
      onTick: jest.fn((callback: () => void) => {
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
});
