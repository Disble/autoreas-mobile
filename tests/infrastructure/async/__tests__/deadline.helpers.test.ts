import {
  DeadlineExceededError,
  withDeadline,
} from '../../../../src/infrastructure/async';

describe('withDeadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the operation result when it settles before the deadline', async () => {
    const result = await withDeadline({
      operation: () => Promise.resolve('done'),
      timeoutMs: 1_000,
      label: 'fast',
    });

    expect(result).toBe('done');
  });

  it('rejects with DeadlineExceededError when the operation never settles', async () => {
    const pending = withDeadline({
      operation: () => new Promise<never>(() => undefined),
      timeoutMs: 1_000,
      label: 'hung',
    });
    const assertion = expect(pending).rejects.toThrow(DeadlineExceededError);

    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
  });

  it('names the label and the elapsed budget in the failure', async () => {
    const pending = withDeadline({
      operation: () => new Promise<never>(() => undefined),
      timeoutMs: 2_500,
      label: 'reconcile_cycle',
    });
    const assertion = expect(pending).rejects.toThrow(/reconcile_cycle.*2500/);

    await jest.advanceTimersByTimeAsync(2_500);

    await assertion;
  });

  it('clears its timer when the operation resolves first', async () => {
    await withDeadline({
      operation: () => Promise.resolve('done'),
      timeoutMs: 1_000,
      label: 'fast',
    });

    // A leaked timer per call would keep the event loop alive and, in a background job,
    // hold the host runtime open long after the cycle finished.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears its timer when the operation rejects first', async () => {
    await expect(
      withDeadline({
        operation: () => Promise.reject(new Error('boom')),
        timeoutMs: 1_000,
        label: 'failing',
      }),
    ).rejects.toThrow('boom');

    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears its timer after the deadline fires', async () => {
    const pending = withDeadline({
      operation: () => new Promise<never>(() => undefined),
      timeoutMs: 1_000,
      label: 'hung',
    });
    const assertion = expect(pending).rejects.toThrow(DeadlineExceededError);

    await jest.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(jest.getTimerCount()).toBe(0);
  });

  it('never lets the losing operation surface as an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    let rejectLate: (reason: unknown) => void = (_reason: unknown) => undefined;
    const pending = withDeadline({
      operation: () =>
        new Promise<never>((_resolve, reject) => {
          rejectLate = reject;
        }),
      timeoutMs: 1_000,
      label: 'late_rejector',
    });
    const assertion = expect(pending).rejects.toThrow(DeadlineExceededError);

    await jest.advanceTimersByTimeAsync(1_000);
    await assertion;

    // The deadline already won; the operation rejecting afterwards must be swallowed.
    rejectLate(new Error('too late'));
    await Promise.resolve();
    await Promise.resolve();

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it('carries the label and timeout on the error for a typed caller', async () => {
    const pending = withDeadline({
      operation: () => new Promise<never>(() => undefined),
      timeoutMs: 750,
      label: 'local_write',
    });
    const assertion = pending.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(750);
    const error = await assertion;

    expect(error).toBeInstanceOf(DeadlineExceededError);
    expect(error).toMatchObject({ label: 'local_write', timeoutMs: 750 });
  });
});
