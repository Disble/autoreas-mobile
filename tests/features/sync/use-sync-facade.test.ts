import { act, renderHook } from '@testing-library/react-native';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime';
import * as settingsModule from '../../../src/features/settings/use-bridge-config';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import { useSyncFacade } from '../../../src/features/sync/use-sync-facade';

jest.mock('../../../src/infrastructure/db/client', () => ({
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime', () => ({
  useOptionalLiveQuery: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

describe('useSyncFacade', () => {
  const rawDb = { name: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();

    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: { deviceId: 'device-1' },
      isConfigured: true,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });
    (dbClient.createDrizzleDb as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    (nativeRuntime.useOptionalLiveQuery as jest.Mock).mockImplementation(
      (_query: unknown, fallbackData: unknown) => ({ data: fallbackData }),
    );
    (runtimeStatusModule.recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
  });

  it('stays passive on mount so root runtime owns bootstrap and websocket wiring', () => {
    renderHook(() => useSyncFacade());

    expect(syncModule.syncPendingOperations).not.toHaveBeenCalled();
  });

  it('exposes pending outbox count and manual sync without auto-starting runtime work', async () => {
    (nativeRuntime.useOptionalLiveQuery as jest.Mock).mockReturnValueOnce({
      data: [{ id: 1 }, { id: 2 }],
    });
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValue({
      syncedCount: 3,
      backlogReadCount: 3,
      hasMorePending: false,
    });

    const { result } = renderHook(() => useSyncFacade());

    expect(result.current.pendingOpsCount).toBe(2);

    await act(async () => {
      await result.current.manualSync();
    });

    expect(syncModule.syncPendingOperations).toHaveBeenCalledTimes(1);
    expect(syncModule.syncPendingOperations).toHaveBeenCalledWith(rawDb);
  });

  it('collapses simultaneous trigger storms into a single in-flight sync request', async () => {
    type SyncResult = { syncedCount: number; backlogReadCount: number; hasMorePending: boolean };
    let resolveSync: ((value: SyncResult) => void) | null = null;

    (syncModule.syncPendingOperations as jest.Mock).mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveSync = resolve;
        }),
    );

    const { result } = renderHook(() => useSyncFacade());

    let firstPromise!: Promise<number>;
    let secondPromise!: Promise<number>;

    await act(async () => {
      firstPromise = result.current.requestSync('bootstrap');
      secondPromise = result.current.requestSync('network_regained');
      await Promise.resolve();
    });

    expect(syncModule.syncPendingOperations).toHaveBeenCalledTimes(1);
    expect(firstPromise).toBe(secondPromise);

    await act(async () => {
      resolveSync?.({ syncedCount: 7, backlogReadCount: 7, hasMorePending: false });
      await firstPromise;
    });

    await expect(firstPromise).resolves.toBe(7);
    await expect(secondPromise).resolves.toBe(7);
  });
});
