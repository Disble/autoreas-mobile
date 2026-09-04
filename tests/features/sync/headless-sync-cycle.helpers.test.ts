import type { SQLiteDatabase } from 'expo-sqlite';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as retentionModule from '../../../src/features/sync/operation-log-retention.helpers';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import {
  buildAbandonedCycleMessage,
  runHeadlessSyncCycle,
} from '../../../src/features/sync/headless-sync-cycle.helpers';
import {
  HEADLESS_SYNC_CYCLE_DEADLINE_MS,
  HEADLESS_SYNC_CYCLE_RECOVERY_DEADLINE_MS,
} from '../../../src/features/sync/headless-sync-cycle.constants';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import type { SyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.types';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  openAppDatabaseSync: jest.fn(),
  runMigrations: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/operation-log-retention.helpers', () => ({
  pruneOperationLog: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  // The cycle reads the PREVIOUS cycle's snapshot before it records its own attempt, so the
  // telemetry post-mortem describes the run that died rather than the one starting now.
  getSyncRuntimeStatusSnapshot: jest.fn().mockResolvedValue({
    registrationStatus: 'registered',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureMessage: null,
    lastTriggerSource: null,
    lastSyncedCount: 0,
    isCycleActive: false,
    lastBacklogReadCount: 0,
    lastPrunedOperationsCount: 0,
    isBackgroundTaskRegistered: false,
    lastCycleId: null,
    lastCycleStage: null,
    lastErrorName: null,
    lastNativeErrcodeByte: null,
    lastErrorStage: null,
    consecutiveUnclosedCycles: 0,
    lastCycleStageAt: null,
    lastFailedCheckpointCount: 0,
  }),
  recordBacklogReadCount: jest.fn(),
  recordCycleActive: jest.fn(),
  recordPrunedOperationsCount: jest.fn(),
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

describe('headless-sync-cycle helpers', () => {
  const rawDb = { id: 'raw-db' } as unknown as SQLiteDatabase;

  function buildRuntime(): SyncSQLiteRuntime {
    return {
      owner: 'headless_cycle',
      rawDb,
      isOpen: () => true,
      open: jest.fn().mockResolvedValue(rawDb),
      withDatabase: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as SyncSQLiteRuntime;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    (dbClient.runMigrations as jest.Mock).mockResolvedValue(undefined);
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.9',
      port: 3000,
      token: 'secret',
      deviceId: 'device-1',
      deviceName: 'Bridge Casa',
      lastChangelogId: 0,
    });
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 3,
      backlogReadCount: 5,
      hasMorePending: false,
    });
    (retentionModule.pruneOperationLog as jest.Mock).mockResolvedValue({
      prunedCount: 7,
      deletedSyncedCount: 4,
      deletedDeadLetterCount: 3,
    });
    (runtimeStatusModule.recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordCycleActive as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordBacklogReadCount as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordPrunedOperationsCount as jest.Mock).mockResolvedValue(undefined);
  });

  it('persists attempt and success for a foreground service cycle, applying in staged mode (never deferred)', async () => {
    const runtime = buildRuntime();
    const result = await runHeadlessSyncCycle({
      runtime,
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(runtime.open).toHaveBeenCalled();
    expect(dbClient.getBridgeConfigSnapshot).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
    );
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, true);
    // The headless/background runtime owns an isolated, non-reactive connection
    // (enableChangeListener:false). It MUST pass 'staged' so the reconcile apply step never
    // writes `animes` directly on this connection -- a mis-set 'deferred' here would
    // silently reintroduce the non-reactive-write regression with no UI feedback.
    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(
      rawDb,
      'staged',
      // The telemetry context rides along on the same call: it is assembled here, before the
      // status writes, because only this caller can see the previous cycle's snapshot intact.
      expect.objectContaining({ appState: 'background' }),
    );
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalledWith(rawDb, 'deferred');
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordBacklogReadCount).toHaveBeenCalledWith(rawDb, 5);
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      3,
    );
    expect(retentionModule.pruneOperationLog).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordPrunedOperationsCount).toHaveBeenCalledWith(rawDb, 7);
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, false);
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('returns no-op without pairing and avoids fake success', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.9',
      port: 3000,
      token: 'secret',
      deviceId: null,
      deviceName: 'Bridge Casa',
      lastChangelogId: 0,
    });

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'no_op', syncedCount: 0 });
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptStarted).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordCycleActive).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('persists a failed foreground service cycle without fabricating success', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
    );
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, true);
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      'Network Error',
    );
    expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, false);
  });

  it('returns success when pruning fails after a successful sync', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (retentionModule.pruneOperationLog as jest.Mock).mockRejectedValue(new Error('prune failed'));

    const result = await runHeadlessSyncCycle({
      runtime: buildRuntime(),
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[runHeadlessSyncCycle] Operation-log pruning failed',
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
  });

  describe('hard cycle deadline', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolves failed instead of hanging when the cycle body never settles', async () => {
      // The device measured 600s of absolute silence inside this call: the host killed the job
      // because `jobFinished` was never reached. The cycle MUST settle on its own budget.
      (syncModule.syncPendingOperations as jest.Mock).mockReturnValue(
        new Promise<never>(() => undefined),
      );

      const pending = runHeadlessSyncCycle({
        runtime: buildRuntime(),
        triggerSource: 'background_task',
      });

      await jest.advanceTimersByTimeAsync(HEADLESS_SYNC_CYCLE_DEADLINE_MS);

      await expect(pending).resolves.toEqual({ kind: 'failed', syncedCount: 0 });
    });

    it('records the abandoned attempt naming the stage the cycle reached', async () => {
      (syncModule.syncPendingOperations as jest.Mock).mockReturnValue(
        new Promise<never>(() => undefined),
      );

      const pending = runHeadlessSyncCycle({
        runtime: buildRuntime(),
        triggerSource: 'background_task',
      });

      await jest.advanceTimersByTimeAsync(HEADLESS_SYNC_CYCLE_DEADLINE_MS);
      await pending;

      expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
        rawDb,
        'background_task',
        expect.any(Number),
        expect.stringContaining('reconcile'),
      );
    });

    it('releases the cycle-active flag on the abandoned path', async () => {
      // `is_cycle_active` is what the Settings tile and the next cycle read. Left true, the
      // database claims a cycle is running that no promise will ever finish.
      (syncModule.syncPendingOperations as jest.Mock).mockReturnValue(
        new Promise<never>(() => undefined),
      );

      const pending = runHeadlessSyncCycle({
        runtime: buildRuntime(),
        triggerSource: 'background_task',
      });

      await jest.advanceTimersByTimeAsync(HEADLESS_SYNC_CYCLE_DEADLINE_MS);
      await pending;

      expect(runtimeStatusModule.recordCycleActive).toHaveBeenCalledWith(rawDb, false);
    });

    it('still resolves when the recovery bookkeeping is itself jammed behind the write door', async () => {
      // The jammed write door is exactly why the cycle was abandoned, so the recovery write can
      // be jammed too. An unbounded recovery would reintroduce the hang it exists to end.
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (syncModule.syncPendingOperations as jest.Mock).mockReturnValue(
        new Promise<never>(() => undefined),
      );
      (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockReturnValue(
        new Promise<never>(() => undefined),
      );

      const pending = runHeadlessSyncCycle({
        runtime: buildRuntime(),
        triggerSource: 'background_task',
      });

      await jest.advanceTimersByTimeAsync(HEADLESS_SYNC_CYCLE_DEADLINE_MS);
      await jest.advanceTimersByTimeAsync(HEADLESS_SYNC_CYCLE_RECOVERY_DEADLINE_MS);

      await expect(pending).resolves.toEqual({ kind: 'failed', syncedCount: 0 });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[runHeadlessSyncCycle] Abandoned-cycle recovery failed',
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });

    it('leaks no timer when the cycle settles well inside its budget', async () => {
      await runHeadlessSyncCycle({
        runtime: buildRuntime(),
        triggerSource: 'background_task',
      });

      // A leaked 35s timer per cycle keeps the background runtime alive after the work is done.
      expect(jest.getTimerCount()).toBe(0);
    });

    it('propagates a non-deadline failure instead of reporting it as abandoned', async () => {
      // A failed open or an unreadable bridge config is already a terminal answer. Collapsing it
      // into the abandoned path would fabricate a stage the cycle never reached and swallow an
      // error `runBackgroundSyncCycle` still classifies (SchemaNotReadyError becomes a no-op).
      (dbClient.getBridgeConfigSnapshot as jest.Mock).mockRejectedValue(new Error('db gone'));

      await expect(
        runHeadlessSyncCycle({
          runtime: buildRuntime(),
          triggerSource: 'background_task',
        }),
      ).rejects.toThrow('db gone');

      expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
    });

    it('does not record an abandoned attempt when the runtime never opened', async () => {
      const runtime = buildRuntime();
      (runtime.open as jest.Mock).mockReturnValue(new Promise<never>(() => undefined));
      Object.defineProperty(runtime, 'rawDb', { get: () => null });

      const pending = runHeadlessSyncCycle({ runtime, triggerSource: 'background_task' });

      await jest.advanceTimersByTimeAsync(HEADLESS_SYNC_CYCLE_DEADLINE_MS);

      await expect(pending).resolves.toEqual({ kind: 'failed', syncedCount: 0 });
      expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
      expect(runtimeStatusModule.recordCycleActive).not.toHaveBeenCalled();
    });
  });

  describe('buildAbandonedCycleMessage', () => {
    it('names both the stage reached and the budget that expired', () => {
      expect(buildAbandonedCycleMessage('reconcile', 35_000)).toBe(
        "Background sync cycle abandoned after 35000ms at stage 'reconcile'",
      );
    });

    it('names whichever stage it is given', () => {
      expect(buildAbandonedCycleMessage('prune', 1_000)).toContain("stage 'prune'");
    });
  });
});
