import type { SQLiteDatabase } from 'expo-sqlite';
import {
  runBackgroundSyncCycle,
} from '../../../src/features/sync/background-sync.helpers';
import * as headlessSyncCycleModule from '../../../src/features/sync/headless-sync-cycle.helpers';
import * as sqliteSyncRuntimeModule from '../../../src/features/sync/sqlite-sync-runtime.helpers';
import type { SyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.types';

const mockClose = jest.fn<Promise<void>, []>();

jest.mock('../../../src/features/sync/headless-sync-cycle.helpers', () => ({
  runHeadlessSyncCycle: jest.fn(),
}));

jest.mock('../../../src/features/sync/sqlite-sync-runtime.helpers', () => ({
  createSyncSQLiteRuntime: jest.fn(),
}));

describe('background sync helpers', () => {
  const rawDb = { id: 'raw-db' } as unknown as SQLiteDatabase;

  function buildRuntime(): SyncSQLiteRuntime {
    return {
      owner: 'headless_cycle',
      rawDb,
      isOpen: () => true,
      open: jest.fn().mockResolvedValue(rawDb),
      withDatabase: jest.fn(),
      close: mockClose,
    } as unknown as SyncSQLiteRuntime;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockClose.mockResolvedValue(undefined);

    (sqliteSyncRuntimeModule.createSyncSQLiteRuntime as jest.Mock).mockReturnValue(buildRuntime());
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'success',
      syncedCount: 3,
    });
  });

  it('delegates the background task cycle to the shared headless sync helper using a runtime', async () => {
    const result = await runBackgroundSyncCycle();

    expect(result).toEqual({ kind: 'success', syncedCount: 3 });
    expect(sqliteSyncRuntimeModule.createSyncSQLiteRuntime).toHaveBeenCalledWith({
      owner: 'headless_cycle',
    });
    expect(headlessSyncCycleModule.runHeadlessSyncCycle).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ owner: 'headless_cycle' }),
      triggerSource: 'background_task',
    });
    expect(mockClose).toHaveBeenCalled();
  });

  it('returns the delegated no-op result unchanged', async () => {
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'no_op',
      syncedCount: 0,
    });

    await expect(runBackgroundSyncCycle()).resolves.toEqual({
      kind: 'no_op',
      syncedCount: 0,
    });
  });

  it('returns the delegated failure result unchanged', async () => {
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'failed',
      syncedCount: 0,
    });

    await expect(runBackgroundSyncCycle()).resolves.toEqual({
      kind: 'failed',
      syncedCount: 0,
    });
  });

  it('closes the runtime even when headless cycle fails', async () => {
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockRejectedValue(
      new Error('boom'),
    );

    await expect(runBackgroundSyncCycle()).rejects.toThrow('boom');
    expect(mockClose).toHaveBeenCalled();
  });
});
