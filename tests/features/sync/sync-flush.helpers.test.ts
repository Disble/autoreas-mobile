import type { SQLiteDatabase } from 'expo-sqlite';
import { getSyncConnectionSnapshot, resetSyncConnectionStore } from '../../../src/features/sync/sync-connection-store';
import {
  registerSyncFlushDispatcher,
  requestFlush,
  resetSyncFlush,
  waitForSyncFlushIdle,
} from '../../../src/features/sync/sync-flush.helpers';
import type { SyncFlushRequest } from '../../../src/features/sync/sync-flush.types';

/** A dummy database handle: the entry point only uses it as its single-flight key. */
const database = { name: 'raw-db' } as unknown as SQLiteDatabase;

/** One dispatched run the test settles by hand, with the request it received. */
interface HeldRun {
  readonly request: SyncFlushRequest;
  readonly resolve: (syncedCount: number) => void;
  readonly reject: (reason: unknown) => void;
}

/** Registers a dispatcher whose runs stay open until the test settles them. */
function registerHeldDispatcher(): { readonly runs: HeldRun[]; readonly activeCount: () => number; readonly maxActive: () => number } {
  const runs: HeldRun[] = [];
  let active = 0;
  let maxActive = 0;

  registerSyncFlushDispatcher((request) => {
    active += 1;
    maxActive = Math.max(maxActive, active);

    return new Promise<number>((resolve, reject) => {
      runs.push({ request, resolve, reject });
    }).finally(() => {
      active -= 1;
    });
  });

  return { runs, activeCount: () => active, maxActive: () => maxActive };
}

/** Lets every queued microtask (a run's settle and its follow-up start) drain. */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe('requestFlush: one entry point, single-flight per database (ADR 009 R-2)', () => {
  beforeEach(() => {
    resetSyncFlush();
    resetSyncConnectionStore();
  });

  afterEach(() => {
    resetSyncFlush();
  });

  it('runs one cycle plus at most one follow-up for concurrent requests, never two at once', async () => {
    const dispatcher = registerHeldDispatcher();

    const first = requestFlush(database, 'local_mutation');
    const second = requestFlush(database, 'season_rating');
    const third = requestFlush(database, 'ws_season_changed');
    const fourth = requestFlush(database, 'manual');

    expect(dispatcher.runs).toHaveLength(1);
    expect(second).toBe(third);
    expect(third).toBe(fourth);

    dispatcher.runs[0].resolve(1);
    await expect(first).resolves.toBe(1);
    await flushMicrotasks();

    expect(dispatcher.runs).toHaveLength(2);
    // The follow-up serves every request it absorbed: the first one names the source, and any
    // season event demands the refresh.
    expect(dispatcher.runs[1].request).toEqual({
      database,
      source: 'local_mutation',
      refreshActiveSeason: true,
    });

    dispatcher.runs[1].resolve(2);
    await expect(second).resolves.toBe(2);
    await waitForSyncFlushIdle(database);

    expect(dispatcher.runs).toHaveLength(2);
    expect(dispatcher.maxActive()).toBe(1);
  });

  it('starts the follow-up even when the running cycle fails, and fails only the callers of that run', async () => {
    const dispatcher = registerHeldDispatcher();
    const first = requestFlush(database, 'app_active');
    const followUp = requestFlush(database, 'local_mutation');

    dispatcher.runs[0].reject(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    await flushMicrotasks();
    dispatcher.runs[1].resolve(3);

    await expect(followUp).resolves.toBe(3);
  });

  it('starts a fresh cycle, not a follow-up, once the previous one settled', async () => {
    const dispatcher = registerHeldDispatcher();
    const first = requestFlush(database, 'bootstrap');
    dispatcher.runs[0].resolve(0);
    await first;
    await waitForSyncFlushIdle(database);

    void requestFlush(database, 'network_regained');

    expect(dispatcher.runs).toHaveLength(2);
    expect(dispatcher.runs[1].request).toEqual({ database, source: 'network_regained', refreshActiveSeason: false });
  });

  it('keeps the running cycle from publishing online over work requested after it started', async () => {
    registerHeldDispatcher();
    void requestFlush(database, 'manual');
    const before = getSyncConnectionSnapshot();

    void requestFlush(database, 'season_rating');

    // Queuing the follow-up starts a newer attempt: the running cycle's terminal write is stale.
    expect(getSyncConnectionSnapshot()).toEqual({ ...before, kind: 'syncing' });
  });

  it('resolves 0 and sends nothing while no dispatcher is registered', async () => {
    await expect(requestFlush(database, 'local_mutation')).resolves.toBe(0);
  });

  it('turns a dispatcher that throws synchronously into a rejected flush', async () => {
    registerSyncFlushDispatcher(() => {
      throw new Error('dispatcher broke');
    });

    await expect(requestFlush(database, 'manual')).rejects.toThrow('dispatcher broke');
    await waitForSyncFlushIdle(database);
  });

  it('unregisters only the dispatcher it registered', async () => {
    const unregisterFirst = registerSyncFlushDispatcher(() => Promise.resolve(1));
    registerSyncFlushDispatcher(() => Promise.resolve(2));

    unregisterFirst();

    await expect(requestFlush(database, 'manual')).resolves.toBe(2);
  });

  it('resolves a queued follow-up with 0 when the dispatcher was unregistered meanwhile', async () => {
    const dispatcher = registerHeldDispatcher();
    void requestFlush(database, 'manual');
    const followUp = requestFlush(database, 'local_mutation');

    resetSyncFlush();
    dispatcher.runs[0].resolve(1);

    await expect(followUp).resolves.toBe(0);
  });
});
