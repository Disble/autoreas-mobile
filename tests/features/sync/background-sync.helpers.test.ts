import type { SQLiteDatabase } from 'expo-sqlite';
import {
  runBackgroundSyncCycle,
} from '../../../src/features/sync/background-sync.helpers';
import * as headlessSyncCycleModule from '../../../src/features/sync/headless-sync-cycle.helpers';
import * as sqliteSyncRuntimeModule from '../../../src/features/sync/sqlite-sync-runtime.helpers';
import * as syncCycleLockModule from '../../../src/features/sync/sync-cycle-lock.helpers';
import type { SyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.types';
import { SchemaNotReadyError } from '../../../src/infrastructure/db/startup';

const mockClose = jest.fn<Promise<void>, []>();

jest.mock('../../../src/features/sync/headless-sync-cycle.helpers', () => ({
  runHeadlessSyncCycle: jest.fn(),
}));

jest.mock('../../../src/features/sync/sqlite-sync-runtime.helpers', () => ({
  createSyncSQLiteRuntime: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-cycle-lock.helpers', () => ({
  withExclusiveSyncCycle: jest.fn(
    async (params: { run: () => Promise<void> }) => params.run(),
  ),
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
    expect(syncCycleLockModule.withExclusiveSyncCycle).toHaveBeenCalledWith(
      expect.objectContaining({ rawDb, owner: 'headless_cycle' }),
    );
    expect(mockClose).toHaveBeenCalled();
  });

  it('reports a no-op result without running the headless cycle when the lock is held by another owner', async () => {
    (syncCycleLockModule.withExclusiveSyncCycle as jest.Mock).mockImplementationOnce(
      async () => undefined,
    );

    await expect(runBackgroundSyncCycle()).resolves.toEqual({ kind: 'no_op', syncedCount: 0 });
    expect(headlessSyncCycleModule.runHeadlessSyncCycle).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it('returns a handled no-op when foreground schema readiness is absent', async () => {
    const runtime = buildRuntime();
    (runtime.open as jest.Mock).mockRejectedValue(new SchemaNotReadyError('missing'));
    (sqliteSyncRuntimeModule.createSyncSQLiteRuntime as jest.Mock).mockReturnValue(runtime);

    await expect(runBackgroundSyncCycle()).resolves.toEqual({
      kind: 'no_op',
      syncedCount: 0,
    });
    expect(syncCycleLockModule.withExclusiveSyncCycle).not.toHaveBeenCalled();
    expect(headlessSyncCycleModule.runHeadlessSyncCycle).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalledTimes(1);
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
