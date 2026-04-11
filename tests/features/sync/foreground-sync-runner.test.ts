jest.useFakeTimers();

import { createForegroundSyncRunner } from '../../../src/features/sync/foreground-sync-runner.helpers';

describe('foreground-sync-runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('runs one cycle immediately and keeps running on the configured interval until stopped', async () => {
    const runCycle = jest.fn(async () => undefined);

    const runner = createForegroundSyncRunner({
      intervalMs: 1_000,
      runCycle,
    });

    const servicePromise = runner.start();

    await Promise.resolve();

    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(runner.isRunning()).toBe(true);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(runCycle).toHaveBeenCalledTimes(2);

    await runner.stop();
    await servicePromise;

    expect(runner.isRunning()).toBe(false);

    await jest.advanceTimersByTimeAsync(3_000);
    expect(runCycle).toHaveBeenCalledTimes(2);
  });

  it('does not start a second loop when start is called twice while already running', async () => {
    const runCycle = jest.fn(async () => undefined);

    const runner = createForegroundSyncRunner({
      intervalMs: 1_000,
      runCycle,
    });

    const firstPromise = runner.start();
    const secondPromise = runner.start();

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(secondPromise).toBe(firstPromise);

    await runner.stop();
    await firstPromise;
  });

  it('continues scheduling future cycles even when one cycle fails', async () => {
    const runCycle = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);

    const runner = createForegroundSyncRunner({
      intervalMs: 1_000,
      runCycle,
    });

    const servicePromise = runner.start();

    await Promise.resolve();
    expect(runCycle).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(runCycle).toHaveBeenCalledTimes(2);

    await runner.stop();
    await servicePromise;
  });
});
