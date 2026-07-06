import { renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useOptionalSQLiteContext } from '../../../infrastructure/db/native-runtime';
import { useSeasonModeStore } from '../../../infrastructure/store/season-mode-store';
import { useBridgeConfig } from '../../settings/use-bridge-config';
import { useWebSocket } from '../../ws/use-websocket';
import { createSyncExecutionFacade } from '../sync-execution-facade';
import { useSyncFacade } from '../use-sync-facade';
import { useSyncRuntime } from '../use-sync-runtime';

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('../../../infrastructure/db/native-runtime', () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock('../../../infrastructure/store/season-mode-store', () => ({
  useSeasonModeStore: jest.fn(),
}));

jest.mock('../../settings/use-bridge-config', () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock('../../ws/use-websocket', () => ({
  useWebSocket: jest.fn(),
}));

jest.mock('../background-sync.task', () => ({
  isBackgroundSyncTaskRegistered: jest.fn().mockResolvedValue(false),
  registerBackgroundSyncTask: jest.fn().mockResolvedValue(undefined),
  unregisterBackgroundSyncTask: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../notifee-foreground-service-adapter', () => ({
  createNotifeeForegroundServiceAdapter: jest.fn(() => ({
    mode: 'android_foreground_service',
    register: jest.fn().mockResolvedValue(undefined),
    unregister: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockResolvedValue({
      registrationStatus: 'unregistered',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
    }),
  })),
}));

jest.mock('../sync-execution-facade', () => ({
  createSyncExecutionFacade: jest.fn(),
}));

jest.mock('../sync-runtime-status.helpers', () => ({
  updateSyncRuntimeStatusSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../sync-execution-strategy.helpers', () => ({
  buildSyncExecutionStatusPatch: jest.fn(() => ({})),
}));

jest.mock('../use-foreground-resync', () => ({
  useForegroundResync: jest.fn(),
}));

jest.mock('../use-remote-change-drain', () => ({
  useRemoteChangeDrain: jest.fn(),
}));

jest.mock('../use-season-mode-sync', () => ({
  useSeasonModeSync: jest.fn(),
}));

jest.mock('../use-sync-facade', () => ({
  useSyncFacade: jest.fn(),
}));

jest.mock('../use-season-sync', () => ({
  useSeasonSync: jest.fn(() => ({
    refreshActiveSeason: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../use-season-sync.helpers', () => ({
  fetchActiveSeasonFromBridge: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../infrastructure/store/active-season-store', () => ({
  useActiveSeasonStore: jest.fn(),
}));

describe('useSyncRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({
      remove: jest.fn(),
    } as never);
    (useOptionalSQLiteContext as jest.Mock).mockReturnValue({ id: 'raw-db' });
    (useBridgeConfig as jest.Mock).mockReturnValue({ isConfigured: true });
    (useSyncFacade as jest.Mock).mockReturnValue({
      requestSync: jest.fn().mockResolvedValue(0),
    });
    (useSeasonModeStore as unknown as jest.Mock).mockImplementation(
      (selector: (state: { setSeasonMode: jest.Mock }) => unknown) =>
        selector({ setSeasonMode: jest.fn() }),
    );
    const executionFacade = {
      hasCurrentStrategy: jest.fn().mockReturnValue(false),
      registerPreferredStrategy: jest.fn().mockResolvedValue(undefined),
      unregisterCurrentStrategy: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue({
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
      }),
    };
    (createSyncExecutionFacade as jest.Mock).mockReturnValue(executionFacade);
    const { useActiveSeasonStore } = jest.requireMock('../../../infrastructure/store/active-season-store');
    useActiveSeasonStore.mockImplementation(
      (selector: (state: { setActiveSeasonSnapshot: jest.Mock }) => unknown) =>
        selector({ setActiveSeasonSnapshot: jest.fn() }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('wires the websocket hook with a dedicated season-changed callback', () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    expect(useWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        onSeasonChanged: expect.any(Function),
      }),
    );
  });
});
