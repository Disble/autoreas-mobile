import {
  BACKGROUND_SYNC_CYCLE_DEADLINE_MS,
  BACKGROUND_SYNC_HOST_RUNTIME_LIMIT_MS,
  BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS,
} from '../../../../src/features/sync/background-sync.constants';
import { resolveBackgroundTaskOutcome } from '../../../../src/features/sync/background-sync.helpers';
import { DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS } from '../../../../src/features/sync/sync-cycle-lock.constants';
import { SQLITE_BUSY_TIMEOUT_MS } from '../../../../src/infrastructure/db/startup/startup.constants';

describe('background sync timing constants form one total order', () => {
  it('orders every bound so the inner one always fires first', () => {
    // Each `<` encodes a reason. Read together they are the guarantee that a stall is always
    // attributed to the narrowest layer that can name it, instead of surfacing as a dead job.
    expect(SQLITE_BUSY_TIMEOUT_MS).toBeLessThan(BACKGROUND_SYNC_CYCLE_DEADLINE_MS);
    expect(BACKGROUND_SYNC_CYCLE_DEADLINE_MS).toBeLessThan(DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS);
    expect(DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS).toBeLessThan(
      BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS,
    );
    expect(BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS).toBeLessThan(
      BACKGROUND_SYNC_HOST_RUNTIME_LIMIT_MS,
    );
  });

  it('keeps the cycle deadline below the lock lease so a stalled cycle releases its own lock', () => {
    // If the cycle outlived its lease, a second owner could reclaim an expired lease while the
    // first is still running -- two concurrent cycles on one database.
    expect(BACKGROUND_SYNC_CYCLE_DEADLINE_MS).toBeLessThan(DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS);
  });

  it('signals the host well before its runtime limit', () => {
    // R8: the job must complete on its own terms. Reaching the host limit is what makes
    // JobScheduler kill and re-enqueue it, which is the loop H06h describes.
    expect(BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS).toBeLessThan(
      BACKGROUND_SYNC_HOST_RUNTIME_LIMIT_MS,
    );
    expect(BACKGROUND_SYNC_HOST_RUNTIME_LIMIT_MS).toBe(600_000);
  });
});

describe('resolveBackgroundTaskOutcome always settles', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports success when the cycle completes', async () => {
    const outcome = await resolveBackgroundTaskOutcome({
      runCycle: () => Promise.resolve(),
    });

    expect(outcome).toBe('success');
  });

  it('reports failure when the cycle throws', async () => {
    const outcome = await resolveBackgroundTaskOutcome({
      runCycle: () => Promise.reject(new Error('cycle blew up')),
    });

    expect(outcome).toBe('failed');
  });

  it('reports failure instead of hanging when the cycle never settles', async () => {
    // THE case. Without this, the defineTask callback never returns, the host's
    // CompletableDeferred is never completed, tasks.awaitAll() suspends, and the platform kills
    // the job at its runtime limit and re-enqueues it -- forever. This is H06h's loop, and
    // settling here is what breaks it.
    const pending = resolveBackgroundTaskOutcome({
      runCycle: () => new Promise<void>(() => undefined),
    });

    await jest.advanceTimersByTimeAsync(BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS);

    await expect(pending).resolves.toBe('failed');
  });

  it('never rejects, so the caller can always map an outcome to a host result', async () => {
    const outcomes = await Promise.all([
      resolveBackgroundTaskOutcome({ runCycle: () => Promise.resolve() }),
      resolveBackgroundTaskOutcome({
        runCycle: () => Promise.reject(new Error('nope')),
      }),
      resolveBackgroundTaskOutcome({
        runCycle: () => {
          throw new Error('synchronous throw');
        },
      }),
    ]);

    expect(outcomes).toEqual(['success', 'failed', 'failed']);
  });

  it('honours a caller-supplied deadline', async () => {
    const pending = resolveBackgroundTaskOutcome({
      runCycle: () => new Promise<void>(() => undefined),
      timeoutMs: 5_000,
    });

    await jest.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBe('failed');
  });

  it('leaves no timer armed once it settles', async () => {
    await resolveBackgroundTaskOutcome({ runCycle: () => Promise.resolve() });

    expect(jest.getTimerCount()).toBe(0);
  });
});
