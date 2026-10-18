import type { SQLiteDatabase } from 'expo-sqlite';
import { runCoordinatedForegroundSyncCycle } from '../../../../src/features/sync/sync-facade.helpers';
import { resetSyncConnectionStore } from '../../../../src/features/sync/sync-connection-store';
import { syncPendingOperations } from '../../../../src/features/sync/reconcile.helpers';
import {
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from '../../../../src/features/sync/sync-runtime-status.helpers';
import { runCoverSweep } from '../../../../src/features/sync/cover-sweep/cover-sweep.helpers';
import { fetchActiveSeasonFromBridge } from '../../../../src/features/sync/season-sync.helpers';
import type { SyncRuntimeTriggerSource } from '../../../../src/features/sync/sync-runtime-status.types';

jest.mock('../../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
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
];

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
        syncedCount: 1, hasMorePending: false,
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
        syncedCount: 0, hasMorePending: true,
      });

      await runCoordinatedForegroundSyncCycle({
        rawDb: RAW_DB,
        source,
        setActiveSeasonSnapshot: jest.fn(),
      });

      expect(runCoverSweep).toHaveBeenCalledTimes(1);
      expect(runCoverSweep).toHaveBeenCalledWith(RAW_DB, undefined, { force: expectedForce });
    });

    it('never writes an attempt outcome for the hasMorePending early return', async () => {
      // CONTRACT (deliberate, not an oversight): the early return sits BEFORE the
      // attempt-succeeded write, so a cycle that hands off to its follow-up records nothing yet.
      (syncPendingOperations as jest.Mock).mockResolvedValue({
        syncedCount: 0, hasMorePending: true,
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
      const failure = new Error('reconcile failed');
      (syncPendingOperations as jest.Mock).mockRejectedValue(failure);

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
        syncedCount: 1, hasMorePending: false,
      });

      await runCoordinatedForegroundSyncCycle({
        rawDb: RAW_DB,
        source,
        setActiveSeasonSnapshot: jest.fn(),
      });

      expect(runCoverSweep).not.toHaveBeenCalled();
    });

    it('never starts runCoverSweep after a rejected sync', async () => {
      const failure = new Error('reconcile failed');
      (syncPendingOperations as jest.Mock).mockRejectedValue(failure);

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
      syncedCount: 1, hasMorePending: false,
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
      syncedCount: 1, hasMorePending: false,
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

describe('runCoordinatedForegroundSyncCycle attempt bookkeeping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (runCoverSweep as jest.Mock).mockResolvedValue({
      fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false,
    });
  });

  it('records the attempt start and its success with nothing but the database and the instant', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 1,
      hasMorePending: false,
    });

    await runCoordinatedForegroundSyncCycle({
      rawDb: RAW_DB,
      source: 'manual',
      setActiveSeasonSnapshot: jest.fn(),
    });

    expect(recordSyncAttemptStarted).toHaveBeenCalledWith(RAW_DB, expect.any(Number));
    expect(recordSyncAttemptSucceeded).toHaveBeenCalledWith(RAW_DB, expect.any(Number));
    expect(recordSyncAttemptFailed).not.toHaveBeenCalled();
  });
});

describe('runCoordinatedForegroundSyncCycle request ids (S4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    (recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (runCoverSweep as jest.Mock).mockResolvedValue({
      fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false,
    });
    (fetchActiveSeasonFromBridge as jest.Mock).mockResolvedValue(null);
  });

  it('hands the sends and the active-season refresh one shared sequence', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 0, hasMorePending: false, shouldRefreshActiveSeason: true,
    });

    await runCoordinatedForegroundSyncCycle({
      rawDb: RAW_DB,
      source: 'manual',
      setActiveSeasonSnapshot: jest.fn(),
    });

    const sendsSequence = (syncPendingOperations as jest.Mock).mock.calls[0][1];
    expect(sendsSequence).toEqual(expect.objectContaining({ cycleId: expect.any(String) }));
    expect((fetchActiveSeasonFromBridge as jest.Mock).mock.calls[0][1]).toBe(sendsSequence);
  });

  it('starts a new sequence for every cycle', async () => {
    (syncPendingOperations as jest.Mock).mockResolvedValue({ syncedCount: 0, hasMorePending: false });
    const input = { rawDb: RAW_DB, source: 'manual' as const, setActiveSeasonSnapshot: jest.fn() };

    await runCoordinatedForegroundSyncCycle(input);
    await runCoordinatedForegroundSyncCycle(input);

    const [first, second] = (syncPendingOperations as jest.Mock).mock.calls.map((call) => call[1].cycleId);
    expect(second).not.toBe(first);
  });
});
