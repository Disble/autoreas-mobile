import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as nativeRuntime from '../../../src/infrastructure/db/native-runtime';
import * as backgroundSyncTaskModule from '../../../src/features/sync/background-sync.task';
import * as bridgeConfigModule from '../../../src/features/settings/use-bridge-config';
import * as syncFacadeModule from '../../../src/features/sync/use-sync-facade';
import * as runtimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import { useSyncRuntime } from '../../../src/features/sync/use-sync-runtime';
import { useWebSocket } from '../../../src/features/ws/use-websocket';

const appStateListeners: Array<(status: string) => void> = [];
const networkListeners: Array<(state: { isConnected?: boolean | null }) => void> = [];

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_: string, listener: (status: string) => void) => {
      appStateListeners.push(listener);

      return {
        remove: jest.fn(() => {
          const index = appStateListeners.indexOf(listener);
          if (index >= 0) {
            appStateListeners.splice(index, 1);
          }
        }),
      };
    }),
  },
}));

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn((listener: (state: { isConnected?: boolean | null }) => void) => {
    networkListeners.push(listener);

    return {
      remove: jest.fn(() => {
        const index = networkListeners.indexOf(listener);
        if (index >= 0) {
          networkListeners.splice(index, 1);
        }
      }),
    };
  }),
}));

jest.mock('../../../src/features/settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../../src/features/sync/use-sync-facade', () => ({
  useSyncFacade: jest.fn(),
}));

jest.mock('../../../src/features/sync/background-sync.task', () => ({
  isBackgroundSyncTaskRegistered: jest.fn(),
  registerBackgroundSyncTask: jest.fn(),
  unregisterBackgroundSyncTask: jest.fn(),
}));

jest.mock('../../../src/infrastructure/db/native-runtime', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  updateSyncRuntimeStatusSnapshot: jest.fn(),
}));

jest.mock('../../../src/features/ws/use-websocket', () => ({
  useWebSocket: jest.fn(),
}));

function emitAppState(status: string) {
  appStateListeners.forEach((listener) => {
    listener(status);
  });
}

function emitNetworkState(isConnected: boolean | null | undefined) {
  networkListeners.forEach((listener) => {
    listener({ isConnected });
  });
}

describe('useSyncRuntime', () => {
  const mockRequestSync = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListeners.length = 0;
    networkListeners.length = 0;
    AppState.currentState = 'active';
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });

    (bridgeConfigModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: { deviceId: 'device-1' },
      isConfigured: true,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });
    mockRequestSync.mockResolvedValue(1);
    (syncFacadeModule.useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: 'idle',
      lastSyncAt: null,
      manualSync: jest.fn(),
      pendingOpsCount: 0,
      requestSync: mockRequestSync,
      syncError: null,
    });
    (backgroundSyncTaskModule.registerBackgroundSyncTask as jest.Mock).mockResolvedValue(undefined);
    (backgroundSyncTaskModule.isBackgroundSyncTaskRegistered as jest.Mock).mockResolvedValue(true);
    (backgroundSyncTaskModule.unregisterBackgroundSyncTask as jest.Mock).mockResolvedValue(undefined);
    (runtimeStatusModule.updateSyncRuntimeStatusSnapshot as jest.Mock).mockResolvedValue(undefined);
    (useWebSocket as jest.Mock).mockImplementation(() => ({}));
  });

  it('boots the paired runtime from root, registers background sync, and owns websocket wiring', async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(backgroundSyncTaskModule.registerBackgroundSyncTask).toHaveBeenCalledTimes(1);
    expect(runtimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenCalledWith(
      { id: 'raw-db' },
      { registrationStatus: 'registered' },
    );
    expect(mockRequestSync).toHaveBeenCalledWith('bootstrap');
    expect(useWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        onSyncRequired: expect.any(Function),
      }),
    );
  });

  it('stays idle and unregisters background sync when no pairing exists', async () => {
    (bridgeConfigModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(backgroundSyncTaskModule.unregisterBackgroundSyncTask).toHaveBeenCalledTimes(1);
    expect(runtimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenCalledWith(
      { id: 'raw-db' },
      { registrationStatus: 'unregistered' },
    );
    expect(backgroundSyncTaskModule.registerBackgroundSyncTask).not.toHaveBeenCalled();
    expect(mockRequestSync).not.toHaveBeenCalled();
    expect(useWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('triggers reconcile when the app returns to the foreground', async () => {
    AppState.currentState = 'background';

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    mockRequestSync.mockClear();

    await act(async () => {
      emitAppState('active');
      await Promise.resolve();
    });

    expect(mockRequestSync).toHaveBeenCalledWith('app_active');
  });

  it('triggers reconcile only when connectivity is regained', async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    mockRequestSync.mockClear();

    await act(async () => {
      emitNetworkState(false);
      emitNetworkState(true);
      emitNetworkState(true);
      await Promise.resolve();
    });

    expect(mockRequestSync).toHaveBeenCalledTimes(1);
    expect(mockRequestSync).toHaveBeenCalledWith('network_regained');
  });

  it('routes websocket sync_required messages through the root runtime', async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    const webSocketArgs = (useWebSocket as jest.Mock).mock.calls.at(-1)?.[0];
    mockRequestSync.mockClear();

    await act(async () => {
      webSocketArgs.onSyncRequired();
      await Promise.resolve();
    });

    expect(mockRequestSync).toHaveBeenCalledWith('ws_sync_required');
  });
});
