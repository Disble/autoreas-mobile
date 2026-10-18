import { act, renderHook } from '@testing-library/react-native';
import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as settingsModule from '../../../src/features/settings/use-bridge-config';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import { useSyncFacade } from '../../../src/features/sync/use-sync-facade';
import { dispatchForegroundSyncFlush } from '../../../src/features/sync/sync-facade.helpers';
import { registerSyncFlushDispatcher, resetSyncFlush } from '../../../src/features/sync/sync-flush.helpers';
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


jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
  recordSyncAttemptStarted: jest.fn(),
  recordSyncAttemptSucceeded: jest.fn(),
}));

// `manualSync`/`requestSync('network_regained')` below now also start a (non-awaited) cover sweep
// -- see `tests/features/sync/__tests__/sync-facade.helpers.test.ts` for that behavior's own
// coverage. Mocked here purely so this file's fully-mocked `client.helpers` (no real
// `getBridgeConfigSnapshot`) never reaches the real cover-sweep dependencies in the background.
jest.mock('../../../src/features/sync/cover-sweep/cover-sweep.helpers', () => ({
  runCoverSweep: jest.fn().mockResolvedValue({
    fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped: false,
  }),
}));
// The `bootstrap` snapshot heal (ADR 009 R-7) is pinned by `reconnect-catch-up.behaviour.test.ts`.
jest.mock('../../../src/features/sync/snapshot-heal.helpers', () => ({ healSnapshotOnDemand: jest.fn() }));

describe('useSyncFacade', () => {
  const rawDb = { name: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();
    resetSyncFlush();
    // What the mounted foreground runtime does: `requestSync` reaches the cycle through it.
    registerSyncFlushDispatcher(dispatchForegroundSyncFlush);

    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: { deviceId: 'device-1' },
      configStatus: 'loaded',
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
      (_query: unknown, fallbackData: unknown) => ({ data: fallbackData, status: 'loaded' }),
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

  it('collapses a trigger storm into one running cycle plus exactly one follow-up, never in parallel', async () => {
    type SyncResult = { syncedCount: number; hasMorePending: boolean };
    const pendingSyncs: ((value: SyncResult) => void)[] = [];

    (syncModule.syncPendingOperations as jest.Mock).mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          pendingSyncs.push(resolve);
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

    await act(async () => {
      pendingSyncs[0]({ syncedCount: 7, hasMorePending: false });
      await firstPromise;
    });

    await expect(firstPromise).resolves.toBe(7);

    await act(async () => {
      for (let tick = 0; tick < 10 && pendingSyncs.length < 2; tick += 1) {
        await Promise.resolve();
      }
    });

    expect(syncModule.syncPendingOperations).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingSyncs[1]({ syncedCount: 2, hasMorePending: false });
      await secondPromise;
    });

    await expect(secondPromise).resolves.toBe(2);
    expect(syncModule.syncPendingOperations).toHaveBeenCalledTimes(2);
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
    expect(warnSpy).toHaveBeenCalledWith(
      '[useSyncFacade] Failed to persist sync failure telemetry',
      expect.any(Error),
    );

    warnSpy.mockRestore();
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

  it('serializes concurrent facade consumers on one cycle at a time and ends both online', async () => {
    type SyncResult = { syncedCount: number; hasMorePending: boolean };
    const pendingReconciles: ((value: SyncResult) => void)[] = [];
    (syncModule.syncPendingOperations as jest.Mock).mockImplementation(
      () =>
        new Promise<SyncResult>((resolve) => {
          pendingReconciles.push(resolve);
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

    expect(syncModule.syncPendingOperations).toHaveBeenCalledTimes(1);
    expect(firstFacade.result.current.connectionStatus).toBe('syncing');
    expect(secondFacade.result.current.connectionStatus).toBe('syncing');

    await act(async () => {
      pendingReconciles[0]({ syncedCount: 1, hasMorePending: false });
      await firstPromise;
      for (let tick = 0; tick < 10 && pendingReconciles.length < 2; tick += 1) {
        await Promise.resolve();
      }
    });

    // The first cycle started before the second request, so only the follow-up may claim online.
    expect(firstFacade.result.current.connectionStatus).toBe('syncing');

    await act(async () => {
      pendingReconciles[1]({ syncedCount: 0, hasMorePending: false });
      await secondPromise;
    });

    expect(syncModule.syncPendingOperations).toHaveBeenCalledTimes(2);
    expect(firstFacade.result.current.connectionStatus).toBe('online');
    expect(secondFacade.result.current.connectionStatus).toBe('online');
  });

  it('includes a queued season rating in the visible count so prior online cannot appear current', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    // A rating waits in the one outbox (L28), so the outbox count already holds it.
    (nativeRuntime.useOptionalLiveQuery as jest.Mock).mockReturnValueOnce({ data: [{ id: 7 }] });

    const { result } = renderHook(() => useSyncFacade());
    const visible = deriveVisibleSyncStatus(
      {
        connectionStatus: result.current.connectionStatus,
        isBridgeConfigured: true,
        isDeviceOnline: true,
        lastSyncAt: result.current.lastSyncAt,
        pendingOpsCount: result.current.pendingOpsCount,
      },
      new Date(2_000),
    );

    expect(result.current.pendingOpsCount).toBe(1);
    // The bridge answered at 1_000, so it is not one to wait for (ADR 009 R-9, S11).
    expect(visible.title).toBe('Bridge conectado');
    expect(visible.chipLabel).not.toBe('Esperando a la PC');
    expect(visible.tone).not.toBe('success');
  });

  it('does not publish online when reconcile reports more bounded backlog', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 100,
      hasMorePending: true,
    });

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).resolves.toBe(100);
    });

    expect(result.current.connectionStatus).not.toBe('online');
  });

  it('does not let an older paused facade overwrite a newer standalone failure', async () => {
    let resolvePass!: (value: { syncedCount: number; hasMorePending: boolean }) => void;
    (syncModule.syncPendingOperations as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolvePass = resolve;
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
      resolvePass({ syncedCount: 0, hasMorePending: false });
      await olderFacadePromise;
    });

    expect(result.current.connectionStatus).toBe('unreachable');
    expect(result.current.connectionStatus).not.toBe('online');
  });

  it('allows online only when the outbox pass leaves nothing pending', async () => {
    (syncModule.syncPendingOperations as jest.Mock).mockResolvedValueOnce({
      syncedCount: 1,
      hasMorePending: false,
    });
    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.manualSync()).resolves.toBe(1);
    });

    expect(result.current.connectionStatus).toBe('online');
    expect(result.current.pendingOpsCount).toBe(0);
  });
});
