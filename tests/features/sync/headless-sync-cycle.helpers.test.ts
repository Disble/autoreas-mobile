import * as dbClient from '../../../src/infrastructure/db/client';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import {
  runHeadlessSyncCycle,
} from '../../../src/features/sync/headless-sync-cycle.helpers';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';

jest.mock('../../../src/infrastructure/db/client', () => ({
  getBridgeConfigSnapshot: jest.fn(),
  openAppDatabaseSync: jest.fn(),
  runMigrations: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

describe('headless-sync-cycle helpers', () => {
  const rawDb = { id: 'raw-db' } as unknown as SQLiteDatabase;

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
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValue(3);
    (runtimeStatusModule.recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
  });

  it('persists attempt and success for a foreground service cycle', async () => {
    const result = await runHeadlessSyncCycle({
      rawDb,
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(dbClient.runMigrations).toHaveBeenCalledWith(rawDb);
    expect(dbClient.getBridgeConfigSnapshot).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
    );
    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      3,
    );
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
      rawDb,
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'no_op', syncedCount: 0 });
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptStarted).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('persists a failed foreground service cycle without fabricating success', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const result = await runHeadlessSyncCycle({
      rawDb,
      triggerSource: 'foreground_service',
    });

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
    );
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      'Network Error',
    );
  });
});
