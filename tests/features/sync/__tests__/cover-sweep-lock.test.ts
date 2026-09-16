import { runCoverStoreExclusive } from '../../../../src/features/sync/cover-sweep/cover-sweep-lock';

/** A promise plus its external resolve, for tests that need to hold a queued task open. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

describe('runCoverStoreExclusive', () => {
  it('runs sequential tasks one at a time, in call order', async () => {
    const order: number[] = [];

    const first = runCoverStoreExclusive(async () => {
      order.push(1);
      return 'a';
    });
    const second = runCoverStoreExclusive(async () => {
      order.push(2);
      return 'b';
    });

    expect(await first).toBe('a');
    expect(await second).toBe('b');
    expect(order).toEqual([1, 2]);
  });

  it('queues a task behind one that is still running, only starting it once the first settles', async () => {
    const deferred = createDeferred<string>();
    const order: string[] = [];

    const first = runCoverStoreExclusive(async () => {
      order.push('first-start');
      const value = await deferred.promise;
      order.push('first-end');
      return value;
    });
    const second = runCoverStoreExclusive(async () => {
      order.push('second-start');
      return 'second-value';
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The second task must NOT have started while the first is still pending.
    expect(order).toEqual(['first-start']);

    deferred.resolve('first-value');

    expect(await first).toBe('first-value');
    expect(await second).toBe('second-value');
    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
  });

  it('a task that rejects does not block the next exclusive task', async () => {
    const first = runCoverStoreExclusive(async () => {
      throw new Error('boom');
    });
    const second = runCoverStoreExclusive(async () => 'ok');

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });

  it('keeps queuing correctly after several rejections in a row', async () => {
    const results: ('rejected' | 'resolved')[] = [];

    const tasks = [1, 2, 3].map((n) =>
      runCoverStoreExclusive(async () => {
        if (n !== 3) {
          throw new Error(`boom-${n}`);
        }
        return 'last';
      }).then(
        () => {
          results.push('resolved');
        },
        () => {
          results.push('rejected');
        },
      ),
    );

    await Promise.all(tasks);

    expect(results).toEqual(['rejected', 'rejected', 'resolved']);
  });
});
