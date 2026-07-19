import { act, renderHook } from '@testing-library/react-native';
import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as settingsModule from '../../../src/features/settings/use-bridge-config';
import * as seasonQueueModule from '../../../src/features/sync/season-rating-queue.helpers';
import * as seasonSyncModule from '../../../src/features/sync/season-sync.helpers';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import { useSyncFacade } from '../../../src/features/sync/use-sync-facade';
import { deriveVisibleSyncStatus } from '../../../src/features/sync/sync-visible-status.helpers';
import {
  beginSyncConnectionAttempt,
  markSyncConnectionFailed,
  markSyncConnectionSucceeded,
  resetSyncConnectionStore,
} from '../../../src/features/sync/sync-connection-store';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  createDrizzleDb: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  useOptionalLiveQuery: jest.fn(),
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../src/features/sync/reconcile.helpers', () => ({
  syncPendingOperations: jest.fn(),
}));

jest.mock('../../../src/features/sync/season-rating-queue.helpers', () => ({
  drainSeasonRatingQueue: jest.fn(),
}));

jest.mock('../../../src/features/sync/season-sync.helpers', () => ({
  fetchActiveSeasonFromBridge: jest.fn(),
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
    resetSyncConnectionStore();

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
    (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0,
      backlogReadCount: 0,
      shouldRefreshActiveSeason: false,
    });
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
    expect(seasonQueueModule.drainSeasonRatingQueue).toHaveBeenCalledWith(rawDb);
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

  it('shares the latest unreachable failure across mounted facade consumers', async () => {
    (syncModule.syncPendingOperations as jest.Mock)
      .mockResolvedValueOnce({
        syncedCount: 0,
        backlogReadCount: 0,
        hasMorePending: false,
      })
      .mockRejectedValueOnce(
        new BridgeUnreachableError('http://bridge.test/api/sync/reconcile', 'offline'),
      );

    const firstFacade = renderHook(() => useSyncFacade());
    const secondFacade = renderHook(() => useSyncFacade());

    await act(async () => {
      await firstFacade.result.current.manualSync();
    });

    expect(firstFacade.result.current.connectionStatus).toBe('online');
    expect(secondFacade.result.current.connectionStatus).toBe('online');

    await act(async () => {
      await expect(secondFacade.result.current.manualSync()).rejects.toBeInstanceOf(
        BridgeUnreachableError,
      );
    });

    expect(firstFacade.result.current.connectionStatus).toBe('unreachable');
    expect(secondFacade.result.current.connectionStatus).toBe('unreachable');
    expect(firstFacade.result.current.lastSyncAt).not.toBeNull();
  });

  it('publishes the original bridge failure even when telemetry persistence also fails', async () => {
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/sync/reconcile',
      'offline',
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValueOnce(unreachableError);
    (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockRejectedValueOnce(
      new Error('telemetry write failed'),
    );

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).rejects.toBe(unreachableError);
    });

    expect(result.current.connectionStatus).toBe('unreachable');
    expect(result.current.syncError).toBe(unreachableError.message);
    expect(warnSpy).toHaveBeenCalledWith(
      '[useSyncFacade] Failed to persist sync failure telemetry',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it('keeps the coordinated cycle syncing until work after reconcile also succeeds', async () => {
    let resolveSeasonDrain!: (value: {
      deliveredCount: number;
      backlogReadCount: number;
      shouldRefreshActiveSeason: boolean;
    }) => void;
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 1,
      backlogReadCount: 1,
      hasMorePending: false,
    });
    (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSeasonDrain = resolve;
        }),
    );

    const { result } = renderHook(() => useSyncFacade());
    let syncPromise!: Promise<number>;

    await act(async () => {
      syncPromise = result.current.manualSync();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.connectionStatus).toBe('syncing');

    await act(async () => {
      resolveSeasonDrain({
        deliveredCount: 0,
        backlogReadCount: 0,
        shouldRefreshActiveSeason: false,
      });
      await syncPromise;
    });

    expect(result.current.connectionStatus).toBe('online');
  });

  it('publishes reachable reconcile rejection as sync_error rather than unreachable', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockRejectedValueOnce(
      new Error('Reconcile failed: 422'),
    );

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).rejects.toThrow('Reconcile failed: 422');
    });

    expect(result.current.connectionStatus).toBe('sync_error');
    expect(result.current.connectionStatus).not.toBe('unreachable');
  });

  it('shares one coordinated full cycle across concurrent facade consumers', async () => {
    type SyncResult = { syncedCount: number; backlogReadCount: number; hasMorePending: boolean };
    let resolveReconcile!: (value: SyncResult) => void;
    (syncModule.syncPendingOperations as jest.Mock).mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          resolveReconcile = resolve;
        }),
    );

    const firstFacade = renderHook(() => useSyncFacade());
    const secondFacade = renderHook(() => useSyncFacade());
    let firstPromise!: Promise<number>;
    let secondPromise!: Promise<number>;

    await act(async () => {
      firstPromise = firstFacade.result.current.manualSync();
      secondPromise = secondFacade.result.current.manualSync();
      await Promise.resolve();
    });

    expect(firstPromise).toBe(secondPromise);
    expect(syncModule.syncPendingOperations).toHaveBeenCalledTimes(1);
    expect(firstFacade.result.current.connectionStatus).toBe('syncing');
    expect(secondFacade.result.current.connectionStatus).toBe('syncing');

    await act(async () => {
      resolveReconcile({ syncedCount: 1, backlogReadCount: 1, hasMorePending: false });
      await firstPromise;
    });

    expect(firstFacade.result.current.connectionStatus).toBe('online');
    expect(secondFacade.result.current.connectionStatus).toBe('online');
  });

  it('never publishes online when season rating delivery remains unreachable', async () => {
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/seasons/active/rating',
      'offline',
    );
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 0,
      backlogReadCount: 0,
      hasMorePending: false,
    });
    (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockResolvedValueOnce({
      deliveredCount: 0,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: false,
      failure: unreachableError,
    });

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).rejects.toBe(unreachableError);
    });

    expect(result.current.connectionStatus).toBe('unreachable');
    expect(result.current.connectionStatus).not.toBe('online');
  });

  it.each(['not_found', 'conflict'])(
    'publishes sync_error when a deleted season rating resolves as %s',
    async (failureKind) => {
      const terminalError = new Error(
        `Season rating delivery incomplete: ${failureKind}`,
      );
      (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
        syncedCount: 0,
        backlogReadCount: 0,
        hasMorePending: false,
      });
      (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockResolvedValueOnce({
        deliveredCount: 0,
        backlogReadCount: 1,
        shouldRefreshActiveSeason: false,
        failure: terminalError,
      });

      const { result } = renderHook(() => useSyncFacade());

      await act(async () => {
        await expect(result.current.manualSync()).rejects.toBe(terminalError);
      });

      expect(result.current.connectionStatus).toBe('sync_error');
      expect(result.current.connectionStatus).not.toBe('online');
    },
  );

  it('publishes unreachable when active-season refresh fails after confirmed delivery', async () => {
    const unreachableError = new BridgeUnreachableError(
      'http://bridge.test/api/seasons/active',
      'offline',
    );
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 1,
      backlogReadCount: 1,
      hasMorePending: false,
    });
    (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockResolvedValueOnce({
      deliveredCount: 1,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: true,
      failure: null,
    });
    (seasonSyncModule.fetchActiveSeasonFromBridge as jest.Mock).mockRejectedValueOnce(
      unreachableError,
    );

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).rejects.toBe(unreachableError);
    });

    expect(runtimeStatusModule.recordSyncAttemptSucceeded).not.toHaveBeenCalled();
    expect(runtimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'manual',
      expect.any(Number),
      unreachableError.message,
    );
    expect(result.current.connectionStatus).toBe('unreachable');
    expect(result.current.connectionStatus).not.toBe('online');
  });

  it('includes unresolved season ratings in visible count so prior online cannot appear current', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    (nativeRuntime.useOptionalLiveQuery as jest.Mock)
      .mockReturnValueOnce({ data: [] })
      .mockReturnValueOnce({ data: [{ id: 7 }] });

    const { result } = renderHook(() => useSyncFacade());
    const visible = deriveVisibleSyncStatus(
      {
        connectionStatus: result.current.connectionStatus,
        isBridgeConfigured: true,
        isDeviceOnline: true,
        lastSyncAt: result.current.lastSyncAt,
        pendingOpsCount: result.current.pendingOpsCount,
        syncError: result.current.syncError,
      },
      new Date(2_000),
    );

    expect(result.current.pendingOpsCount).toBe(1);
    expect(visible.title).not.toBe('Catálogo al día');
    expect(visible.tone).toBe('warning');
  });

  it('does not publish online when reconcile reports more bounded backlog', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 100,
      backlogReadCount: 100,
      hasMorePending: true,
    });

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).resolves.toBe(100);
    });

    expect(result.current.connectionStatus).not.toBe('online');
  });

  it('does not let an older paused facade overwrite a newer standalone failure', async () => {
    let resolveSeasonDrain!: (value: {
      deliveredCount: number;
      backlogReadCount: number;
      shouldRefreshActiveSeason: boolean;
      failure: Error | null;
    }) => void;
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 0,
      backlogReadCount: 0,
      hasMorePending: false,
    });
    (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSeasonDrain = resolve;
      }),
    );
    const { result } = renderHook(() => useSyncFacade());
    let olderFacadePromise!: Promise<number>;

    await act(async () => {
      olderFacadePromise = result.current.manualSync();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      const newerStandaloneAttempt = beginSyncConnectionAttempt();
      markSyncConnectionFailed(
        newerStandaloneAttempt,
        new BridgeUnreachableError('http://bridge.test/api/sync/reconcile', 'offline'),
      );
    });

    await act(async () => {
      resolveSeasonDrain({
        deliveredCount: 0,
        backlogReadCount: 0,
        shouldRefreshActiveSeason: false,
        failure: null,
      });
      await olderFacadePromise;
    });

    expect(result.current.connectionStatus).toBe('unreachable');
    expect(result.current.connectionStatus).not.toBe('online');
  });

  it('allows online only when operation and season work are fully resolved', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 1,
      backlogReadCount: 1,
      hasMorePending: false,
    });
    (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockResolvedValueOnce({
      deliveredCount: 1,
      backlogReadCount: 1,
      shouldRefreshActiveSeason: false,
      failure: null,
    });
    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).resolves.toBe(1);
    });

    expect(result.current.connectionStatus).toBe('online');
    expect(result.current.pendingOpsCount).toBe(0);
  });
});
