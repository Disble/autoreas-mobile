import { act, renderHook } from '@testing-library/react-native';
import { BridgeUnreachableError } from '../../../src/infrastructure/api';
import * as dbClient from '../../../src/infrastructure/db/client/client.helpers';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime/native-runtime.helpers';
import * as settingsModule from '../../../src/features/settings/use-bridge-config';
import * as seasonQueueModule from '../../../src/features/sync/season-rating-queue.helpers';
import * as syncModule from '../../../src/features/sync/reconcile.helpers';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import { useSyncFacade } from '../../../src/features/sync/use-sync-facade';
import {
  beginSyncConnectionAttempt,
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

describe('useSyncFacade shared connection truth', () => {
  const rawDb = { name: 'raw-db' };

  beforeEach(() => {
    jest.clearAllMocks();
    resetSyncConnectionStore();

    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(rawDb);
    (nativeRuntime.useOptionalLiveQuery as jest.Mock).mockImplementation(
      (_query: unknown, fallbackData: unknown) => ({ data: fallbackData, status: 'loaded' }),
    );
    (dbClient.createDrizzleDb as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: { deviceId: 'device-1' },
      configStatus: 'loaded',
      isConfigured: true,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });
    (runtimeStatusModule.recordSyncAttemptStarted as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptSucceeded as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.recordSyncAttemptFailed as jest.Mock).mockResolvedValue(undefined);
    (seasonQueueModule.drainSeasonRatingQueue as jest.Mock).mockResolvedValue({
      deliveredCount: 0,
      backlogReadCount: 0,
      shouldRefreshActiveSeason: false,
    });
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

  it('keeps shared online truth while a mounting consumer still loads its bridge config', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    // The bridge-config live query answers asynchronously and starts with an empty result set,
    // so a freshly mounted consumer reads isConfigured=false for one render even while paired.
    // Publishing that as truth is what dropped the bridge connection on entering Settings.
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValueOnce({
      config: null,
      configStatus: 'pending',
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });

    const { result, rerender } = renderHook(() => useSyncFacade());
    rerender(undefined);

    expect(result.current.connectionStatus).toBe('online');
    expect(result.current.lastSyncAt).toBe(1_000);
  });

  it('leaves the live bridge status alone when a sync is requested before the config answers', async () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      configStatus: 'pending',
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });

    const { result } = renderHook(() => useSyncFacade());

    await act(async () => {
      await expect(result.current.requestSync('manual')).resolves.toBe(0);
    });

    expect(syncModule.syncPendingOperations).not.toHaveBeenCalled();
    expect(result.current.connectionStatus).toBe('online');
  });

  it('drops stale online truth once the bridge config resolves as unpaired', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      configStatus: 'loaded',
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });

    const { result } = renderHook(() => useSyncFacade());

    expect(result.current.connectionStatus).toBe('idle');
  });

  it('drops stale online truth when the bridge config query can never answer', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    // A rejected live query never stamps a result, so waiting on it would keep a stale online
    // claim alive forever. An unanswerable query is not evidence of a healthy bridge.
    (settingsModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      configStatus: 'unavailable',
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });

    const { result } = renderHook(() => useSyncFacade());

    expect(result.current.connectionStatus).toBe('idle');
  });

  it('drops stale online truth when the database is unavailable', () => {
    const attempt = beginSyncConnectionAttempt();
    markSyncConnectionSucceeded(attempt, 1_000);
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useSyncFacade());

    expect(result.current.connectionStatus).toBe('idle');
  });
});
