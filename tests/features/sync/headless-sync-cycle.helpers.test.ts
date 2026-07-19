import type { SQLiteDatabase } from 'expo-sqlite';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as retentionModule from '../../../src/features/sync/operation-log-retention.helpers';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import {
  runHeadlessSyncCycle,
} from '../../../src/features/sync/headless-sync-cycle.helpers';
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
    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(rawDb, 'staged');
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
});
