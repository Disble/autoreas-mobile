import type { SQLiteDatabase } from 'expo-sqlite';
import { runCoordinatedForegroundSyncCycle } from '../../../../src/features/sync/sync-facade.helpers';
import { resetSyncConnectionStore } from '../../../../src/features/sync/sync-connection-store';
import { syncPendingOperations } from '../../../../src/features/sync/reconcile.helpers';
import { drainSeasonRatingQueue } from '../../../../src/features/sync/season-rating-queue.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from '../../../../src/features/sync/sync-runtime-status.helpers';
import { runCoverSweep } from '../../../../src/features/sync/cover-sweep/cover-sweep.helpers';
import type { SyncDiagnosticsFlushResult } from '../../../../src/features/sync/sync-diagnostics-flush.types';
import type { SyncRuntimeTriggerSource } from '../../../../src/features/sync/sync-runtime-status.types';

jest.mock('../../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../../src/features/sync/season-rating-queue.helpers', () => ({
  drainSeasonRatingQueue: jest.fn(),
}));

jest.mock('../../../../src/features/sync/season-sync.helpers', () => ({
  ...jest.requireActual('../../../../src/features/sync/season-sync.helpers'),
  fetchActiveSeasonFromBridge: jest.fn(),
}));

jest.mock('../../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

jest.mock('../../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn(),
}));

/** A dummy `SQLiteDatabase` handle: every dependency that would read it is faked above. */
const RAW_DB = { id: 'raw-db' } as unknown as SQLiteDatabase;

/** Sources whose settled foreground sync cycle must also start a (non-awaited) cover sweep. */
const TRIGGER_SOURCES: readonly SyncRuntimeTriggerSource[] = [
  'manual',
  'ws_sync_required',
  'network_regained',
];

/** Sources that must NEVER start a cover sweep from this cycle. */
const NON_TRIGGER_SOURCES: readonly SyncRuntimeTriggerSource[] = [
  'bootstrap',
  'app_active',
  'local_mutation',
  'local_mutation_write',
  'foreground_service',
  'background_task',
];

/**
 * One cycle's diagnostics flush result, with the three counters deliberately distinct so a test
 * cannot pass while two columns share a value.
 */
const FOREGROUND_DIAGNOSTICS_FLUSH: SyncDiagnosticsFlushResult = {
  attempted: 4,
  delivered: 1,
  discarded: 2,
  failedRemovals: 1,
  undeliverable: 3,
  unclassified: 4,
};

describe('runCoordinatedForegroundSyncCycle cover-sweep trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (runCoverSweep as jest.Mock).mockResolvedValue({
      fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false,
    });
  });

  describe.each(TRIGGER_SOURCES)('source: %s', (source) => {
    /** Only a manual pull forces every active cover to revalidate; the other two triggers keep the TTL. */
    const expectedForce = source === 'manual';

    it('starts runCoverSweep(rawDb, undefined, { force }) after a successful sync', async () => {
      (syncPendingOperations as jest.Mock).mockResolvedValue({
        syncedCount: 1, backlogReadCount: 0, hasMorePending: false,
      });
      (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
        deliveredCount: 0, backlogReadCount: 0, shouldRefreshActiveSeason: false, failure: null,
      });

      await runCoordinatedForegroundSyncCycle({
        rawDb: RAW_DB,
        source,
        setActiveSeasonSnapshot: jest.fn(),
      });

      expect(runCoverSweep).toHaveBeenCalledTimes(1);
      expect(runCoverSweep).toHaveBeenCalledWith(RAW_DB, undefined, { force: expectedForce });
    });

    it('starts runCoverSweep(rawDb, undefined, { force }) on the hasMorePending early return', async () => {
      (syncPendingOperations as jest.Mock).mockResolvedValue({
        syncedCount: 0, backlogReadCount: 5, hasMorePending: true,
      });
      (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
        deliveredCount: 0, backlogReadCount: 0, shouldRefreshActiveSeason: false, failure: null,
      });

      await runCoordinatedForegroundSyncCycle({
        rawDb: RAW_DB,
        source,
        setActiveSeasonSnapshot: jest.fn(),
      });

      expect(runCoverSweep).toHaveBeenCalledTimes(1);
      expect(runCoverSweep).toHaveBeenCalledWith(RAW_DB, undefined, { force: expectedForce });
    });

    it('never writes status for the hasMorePending early return, so its flush counters stay unpersisted', async () => {
      // CONTRACT (deliberate, not an oversight): the early return sits BEFORE the
      // attempt-succeeded write, and the flush counters ride that write -- see
      // `runCoordinatedForegroundSyncCycle`'s own doc comment for the cost/coverage trade-off.
      (syncPendingOperations as jest.Mock).mockResolvedValue({
        syncedCount: 0, backlogReadCount: 5, hasMorePending: true,
        diagnosticsFlush: FOREGROUND_DIAGNOSTICS_FLUSH,
      });
      (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
        deliveredCount: 0, backlogReadCount: 0, shouldRefreshActiveSeason: false, failure: null,
      });

      await runCoordinatedForegroundSyncCycle({
        rawDb: RAW_DB,
        source,
        setActiveSeasonSnapshot: jest.fn(),
      });

      expect(recordSyncAttemptSucceeded).not.toHaveBeenCalled();
      expect(recordSyncAttemptFailed).not.toHaveBeenCalled();
    });

    it('starts runCoverSweep(rawDb, undefined, { force }) after a rejected sync', async () => {
      const failure = new Error('season rating delivery failed');
      (syncPendingOperations as jest.Mock).mockResolvedValue({
        syncedCount: 0, backlogReadCount: 0, hasMorePending: false,
      });
      (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
        deliveredCount: 0, backlogReadCount: 1, shouldRefreshActiveSeason: false, failure,
      });

      await expect(
        runCoordinatedForegroundSyncCycle({
          rawDb: RAW_DB,
          source,
          setActiveSeasonSnapshot: jest.fn(),
        }),
      ).rejects.toBe(failure);

      expect(runCoverSweep).toHaveBeenCalledTimes(1);
      expect(runCoverSweep).toHaveBeenCalledWith(RAW_DB, undefined, { force: expectedForce });
    });
  });

  describe.each(NON_TRIGGER_SOURCES)('source: %s', (source) => {
    it('never starts runCoverSweep after a successful sync', async () => {
      (syncPendingOperations as jest.Mock).mockResolvedValue({
        syncedCount: 1, backlogReadCount: 0, hasMorePending: false,
      });
      (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
        deliveredCount: 0, backlogReadCount: 0, shouldRefreshActiveSeason: false, failure: null,
      });

      await runCoordinatedForegroundSyncCycle({
        rawDb: RAW_DB,
        source,
        setActiveSeasonSnapshot: jest.fn(),
      });

      expect(runCoverSweep).not.toHaveBeenCalled();
    });

    it('never starts runCoverSweep after a rejected sync', async () => {
      const failure = new Error('season rating delivery failed');
      (syncPendingOperations as jest.Mock).mockResolvedValue({
        syncedCount: 0, backlogReadCount: 0, hasMorePending: false,
      });
      (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
        deliveredCount: 0, backlogReadCount: 1, shouldRefreshActiveSeason: false, failure,
      });

      await expect(
        runCoordinatedForegroundSyncCycle({
          rawDb: RAW_DB,
          source,
          setActiveSeasonSnapshot: jest.fn(),
        }),
      ).rejects.toBe(failure);

      expect(runCoverSweep).not.toHaveBeenCalled();
    });
  });

  it('never awaits the sweep -- a never-resolving runCoverSweep must not block the returned promise', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 1, backlogReadCount: 0, hasMorePending: false,
    });
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0, backlogReadCount: 0, shouldRefreshActiveSeason: false, failure: null,
    });
    (runCoverSweep as jest.Mock).mockReturnValue(new Promise<never>(() => undefined));

    const result = await runCoordinatedForegroundSyncCycle({
      rawDb: RAW_DB,
      source: 'manual',
      setActiveSeasonSnapshot: jest.fn(),
    });

    expect(result).toBe(1);
    expect(runCoverSweep).toHaveBeenCalledWith(RAW_DB, undefined, { force: true });
  });

  it('swallows a rejected cover sweep instead of throwing out of the cycle', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 1, backlogReadCount: 0, hasMorePending: false,
    });
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0, backlogReadCount: 0, shouldRefreshActiveSeason: false, failure: null,
    });
    (runCoverSweep as jest.Mock).mockRejectedValue(new Error('sweep boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      runCoordinatedForegroundSyncCycle({
        rawDb: RAW_DB,
        source: 'manual',
        setActiveSeasonSnapshot: jest.fn(),
      }),
    ).resolves.toBe(1);

    // Flush the microtask queue so the attached `.catch` has a chance to run before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('runCoordinatedForegroundSyncCycle diagnostics flush counters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0, backlogReadCount: 0, shouldRefreshActiveSeason: false, failure: null,
    });
    (runCoverSweep as jest.Mock).mockResolvedValue({
      fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false,
    });
  });

  it('hands the cycle flush result to the attempt-succeeded write it already performs', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 1,
      backlogReadCount: 1,
      hasMorePending: false,
      diagnosticsFlush: FOREGROUND_DIAGNOSTICS_FLUSH,
    });

    await runCoordinatedForegroundSyncCycle({
      rawDb: RAW_DB,
      source: 'manual',
      setActiveSeasonSnapshot: jest.fn(),
    });

    expect(recordSyncAttemptSucceeded).toHaveBeenCalledWith(
      RAW_DB,
      'manual',
      expect.any(Number),
      1,
      null,
      FOREGROUND_DIAGNOSTICS_FLUSH,
    );
  });
});
