import * as dbClient from '../../../src/infrastructure/db/client';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import {
  runBackgroundSyncCycle,
} from '../../../src/features/sync/background-sync.helpers';
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

describe('background sync helpers', () => {
  const rawDb = { id: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();

    (dbClient.openAppDatabaseSync as jest.Mock).mockReturnValue(rawDb);
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

  it('persiste attempt+success cuando reconcile headless termina bien', async () => {
    const result = await runBackgroundSyncCycle();

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(dbClient.runMigrations).toHaveBeenCalledWith(rawDb);
    expect(dbClient.getBridgeConfigSnapshot).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'background_task',
      expect.any(Number),
    );
    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(rawDb);
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).toHaveBeenCalledWith(
      rawDb,
      'background_task',
      expect.any(Number),
      3,
    );
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('retorna no-op sin pairing válido y no finge éxito', async () => {
    (dbClient.getBridgeConfigSnapshot as jest.Mock).mockResolvedValue({
      id: 1,
      ip: '192.168.1.9',
      port: 3000,
      token: 'secret',
      deviceId: null,
      deviceName: 'Bridge Casa',
      lastChangelogId: 0,
    });

    const result = await runBackgroundSyncCycle();

    expect(result).toEqual({ kind: 'no_op', syncedCount: 0 });
    expect(syncModule.syncPendingOperations).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptStarted).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
  });

  it('persiste failure observable cuando reconcile headless falla', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValue(new Error('Network Error'));

    const result = await runBackgroundSyncCycle();

    expect(result).toEqual({ kind: 'failed', syncedCount: 0 });
    expect(runtimeStatusModule.recordSyncAttemptStarted).toHaveBeenCalledWith(
      rawDb,
      'background_task',
      expect.any(Number),
    );
    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'background_task',
      expect.any(Number),
      'Network Error',
    );
  });
});
