import { runWithConcurrency } from '../../../../src/infrastructure/async';

/** A promise plus its external resolve/reject, so a test can control settle order precisely. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('runWithConcurrency', () => {
  it('resolves immediately with stopped: false for an empty item list', async () => {
    const worker = jest.fn();

    const result = await runWithConcurrency([], 2, worker);

    expect(result).toEqual({ stopped: false });
    expect(worker).not.toHaveBeenCalled();
  });

  it('runs every item and reports stopped: false when nothing stops', async () => {
    const seen: number[] = [];
    const worker = jest.fn(async (item: number) => {
      seen.push(item);
      return 'continue' as const;
    });

    const result = await runWithConcurrency([1, 2, 3, 4], 2, worker);

    expect(result).toEqual({ stopped: false });
    expect(seen.sort()).toEqual([1, 2, 3, 4]);
    expect(worker).toHaveBeenCalledTimes(4);
  });

  it('never runs more than `limit` workers in flight at once', async () => {
    const deferreds = [0, 1, 2, 3, 4].map(() => createDeferred<ConcurrencyWorkerOutcomeAlias>());
    let inFlight = 0;
    let maxInFlight = 0;

    const worker = jest.fn(async (item: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const outcome = await deferreds[item].promise;
      inFlight -= 1;
      return outcome;
    });

    const pending = runWithConcurrency([0, 1, 2, 3, 4], 2, worker);

    // Let the first wave of microtasks schedule workers.
    await Promise.resolve();
    await Promise.resolve();

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(worker).toHaveBeenCalledTimes(2);

    for (const deferred of deferreds) {
      deferred.resolve('continue');
      await Promise.resolve();
    }

    await pending;

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('stops scheduling new items after a worker returns stop, but awaits in-flight ones', async () => {
    const order: number[] = [];
    const secondDeferred = createDeferred<ConcurrencyWorkerOutcomeAlias>();

    const worker = jest.fn(async (item: number) => {
      order.push(item);
      if (item === 0) {
        return 'stop' as const;
      }
      if (item === 1) {
        return secondDeferred.promise;
      }
      return 'continue' as const;
    });

    const pending = runWithConcurrency([0, 1, 2, 3], 1, worker);
    secondDeferred.resolve('continue');

    const result = await pending;

    expect(result).toEqual({ stopped: true });
    // Only item 0 (which stopped) should have run with limit 1; nothing after it starts.
    expect(order).toEqual([0]);
  });

  it('awaits in-flight workers before rejecting when one throws', async () => {
    const inFlightDeferred = createDeferred<ConcurrencyWorkerOutcomeAlias>();
    let inFlightSettled = false;

    const worker = jest.fn(async (item: number) => {
      if (item === 0) {
        throw new Error('boom');
      }
      await inFlightDeferred.promise;
      inFlightSettled = true;
      return 'continue' as const;
    });

    const pending = runWithConcurrency([0, 1], 2, worker).catch((error: unknown) => error);

    // Give the throwing worker a tick to actually throw before we resolve the other one.
    await Promise.resolve();
    inFlightDeferred.resolve('continue');

    const outcome = await pending;

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('boom');
    expect(inFlightSettled).toBe(true);
  });

  it('keeps the error from the lowest-indexed lane, not the chronologically-first one', async () => {
    const laneZeroDeferred = createDeferred<ConcurrencyWorkerOutcomeAlias>();
    const laneZeroError = new Error('lane-0-error');
    const laneOneError = new Error('lane-1-error');

    const worker = jest.fn(async (item: number) => {
      if (item === 0) {
        // Lane 0 (processing item 0): only throws once explicitly released below, so it throws
        // strictly AFTER lane 1 already has.
        await laneZeroDeferred.promise;
        throw laneZeroError;
      }
      // Lane 1 (processing item 1): throws immediately -- chronologically first.
      throw laneOneError;
    });

    const pending = runWithConcurrency([0, 1], 2, worker).catch((error: unknown) => error);

    // Let lane 1 throw (and settle) before lane 0 does.
    await Promise.resolve();
    await Promise.resolve();
    laneZeroDeferred.resolve('continue');

    const outcome = await pending;

    // Lane 1's error happened first in wall-clock time, but lane 0 has the lower lane index, so
    // ITS error is the one the caller sees -- a deterministic, index-ordered choice rather than a
    // timing-dependent one.
    expect(outcome).toBe(laneZeroError);
  });

  it('runs all items when the limit is larger than the item count', async () => {
    const worker = jest.fn(async () => 'continue' as const);

    const result = await runWithConcurrency(['a', 'b'], 10, worker);

    expect(result).toEqual({ stopped: false });
    expect(worker).toHaveBeenCalledTimes(2);
  });
});

/** Local alias for the worker outcome literal union, used by the deferred-promise fixtures above. */
type ConcurrencyWorkerOutcomeAlias = 'continue' | 'stop';
