import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import * as nativeRuntime from "../../../src/infrastructure/db/native-runtime";
import * as backgroundSyncTaskModule from "../../../src/features/sync/background-sync.task";
import * as bridgeConfigModule from "../../../src/features/settings/use-bridge-config";
import * as syncExecutionFacadeModule from "../../../src/features/sync/sync-execution-facade";
import * as syncFacadeModule from "../../../src/features/sync/use-sync-facade";
import * as runtimeStatusModule from "../../../src/features/sync/sync-runtime-status.helpers";
import { useSyncRuntime } from "../../../src/features/sync/use-sync-runtime";
import { useRemoteChangeDrain } from "../../../src/features/sync/use-remote-change-drain";
import { useWebSocket } from "../../../src/features/ws/use-websocket";

const appStateListeners: ((status: string) => void)[] = [];
const networkListeners: ((state: { isConnected?: boolean | null }) => void)[] = [];

jest.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: jest.fn(
      (_: string, listener: (status: string) => void) => {
        appStateListeners.push(listener);

        return {
          remove: jest.fn(() => {
            const index = appStateListeners.indexOf(listener);
            if (index >= 0) {
              appStateListeners.splice(index, 1);
            }
          }),
        };
      },
    ),
  },
}));

jest.mock("expo-network", () => ({
  addNetworkStateListener: jest.fn(
    (listener: (state: { isConnected?: boolean | null }) => void) => {
      networkListeners.push(listener);

      return {
        remove: jest.fn(() => {
          const index = networkListeners.indexOf(listener);
          if (index >= 0) {
            networkListeners.splice(index, 1);
          }
        }),
      };
    },
  ),
}));

jest.mock("../../../src/features/settings/use-bridge-config", () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock("../../../src/features/sync/use-sync-facade", () => ({
  useSyncFacade: jest.fn(),
}));

jest.mock("../../../src/features/sync/background-sync.task", () => ({
  isBackgroundSyncTaskRegistered: jest.fn(),
  registerBackgroundSyncTask: jest.fn(),
  unregisterBackgroundSyncTask: jest.fn(),
}));

jest.mock("../../../src/features/sync/sync-execution-facade", () => ({
  createSyncExecutionFacade: jest.fn(),
}));

jest.mock("../../../src/infrastructure/db/native-runtime", () => ({
  useOptionalSQLiteContext: jest.fn(),
}));

jest.mock("../../../src/features/sync/sync-runtime-status.helpers", () => ({
  updateSyncRuntimeStatusSnapshot: jest.fn(),
}));

jest.mock("../../../src/features/ws/use-websocket", () => ({
  useWebSocket: jest.fn(),
}));

jest.mock("../../../src/features/sync/use-remote-change-drain", () => ({
  useRemoteChangeDrain: jest.fn(),
}));

jest.mock("../../../src/features/sync/use-foreground-resync", () => ({
  useForegroundResync: jest.fn(),
}));

jest.mock("../../../src/features/sync/use-season-mode-sync", () => ({
  useSeasonModeSync: jest.fn(),
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

describe("useSyncRuntime", () => {
  const mockRequestSync = jest.fn();
  const mockRegisterPreferredStrategy = jest.fn();
  const mockHasCurrentStrategy = jest.fn();
  const mockUnregisterCurrentStrategy = jest.fn();
  const mockGetStatus = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListeners.length = 0;
    networkListeners.length = 0;
    AppState.currentState = "active";
    (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({
      id: "raw-db",
    });

    (bridgeConfigModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: { deviceId: "device-1" },
      isConfigured: true,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });
    mockRequestSync.mockResolvedValue(1);
    (syncFacadeModule.useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: "idle",
      lastSyncAt: null,
      manualSync: jest.fn(),
      pendingOpsCount: 0,
      requestSync: mockRequestSync,
      syncError: null,
    });
    (
      backgroundSyncTaskModule.registerBackgroundSyncTask as jest.Mock
    ).mockResolvedValue(undefined);
    (
      backgroundSyncTaskModule.isBackgroundSyncTaskRegistered as jest.Mock
    ).mockResolvedValue(true);
    (
      backgroundSyncTaskModule.unregisterBackgroundSyncTask as jest.Mock
    ).mockResolvedValue(undefined);
    mockRegisterPreferredStrategy.mockResolvedValue(undefined);
    mockHasCurrentStrategy.mockReturnValue(false);
    mockUnregisterCurrentStrategy.mockResolvedValue(undefined);
    mockGetStatus.mockResolvedValue({
      registrationStatus: "registered",
      executionMode: "best_effort_background_task",
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
    });
    (
      syncExecutionFacadeModule.createSyncExecutionFacade as jest.Mock
    ).mockReturnValue({
      registerPreferredStrategy: mockRegisterPreferredStrategy,
      hasCurrentStrategy: mockHasCurrentStrategy,
      unregisterCurrentStrategy: mockUnregisterCurrentStrategy,
      getStatus: mockGetStatus,
    });
    (
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot as jest.Mock
    ).mockResolvedValue(undefined);
    (useWebSocket as jest.Mock).mockImplementation(() => ({}));
  });

  it("boots the paired runtime from root, registers background sync, and owns websocket wiring", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRegisterPreferredStrategy).toHaveBeenCalledTimes(1);
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledWith(
      { id: "raw-db" },
      {
        registrationStatus: "registered",
        executionMode: "best_effort_background_task",
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
      },
    );
    expect(mockRequestSync).toHaveBeenCalledWith("bootstrap");
    expect(useWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        onSyncRequired: expect.any(Function),
      }),
    );
    expect(useRemoteChangeDrain).toHaveBeenCalled();
  });

  it("stays idle and unregisters background sync when no pairing exists", async () => {
    (bridgeConfigModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });
    mockGetStatus.mockResolvedValueOnce({
      registrationStatus: "unregistered",
      executionMode: "best_effort_background_task",
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
    });

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUnregisterCurrentStrategy).toHaveBeenCalledTimes(1);
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledWith(
      { id: "raw-db" },
      {
        registrationStatus: "unregistered",
        executionMode: "best_effort_background_task",
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
      },
    );
    expect(
      backgroundSyncTaskModule.registerBackgroundSyncTask,
    ).not.toHaveBeenCalled();
    expect(mockRequestSync).not.toHaveBeenCalled();
    expect(useWebSocket).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("triggers reconcile when the app returns to the foreground", async () => {
    AppState.currentState = "background";

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    mockRequestSync.mockClear();

    await act(async () => {
      emitAppState("active");
      await Promise.resolve();
    });

    expect(mockRequestSync).toHaveBeenCalledWith("app_active");
  });

  it("triggers reconcile only when connectivity is regained", async () => {
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
    expect(mockRequestSync).toHaveBeenCalledWith("network_regained");
  });

  it("routes websocket sync_required messages through the root runtime", async () => {
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

    expect(mockRequestSync).toHaveBeenCalledWith("ws_sync_required");
  });

  it("swallows handled auto-sync failures so Expo does not surface unhandled promise rejections", async () => {
    mockRequestSync.mockRejectedValue(new Error("Network request failed"));

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const webSocketArgs = (useWebSocket as jest.Mock).mock.calls.at(-1)?.[0];

    await act(async () => {
      emitAppState("background");
      emitAppState("active");
      emitNetworkState(false);
      emitNetworkState(true);
      webSocketArgs.onSyncRequired();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRequestSync).toHaveBeenCalledWith("bootstrap");
    expect(mockRequestSync).toHaveBeenCalledWith("app_active");
    expect(mockRequestSync).toHaveBeenCalledWith("network_regained");
    expect(mockRequestSync).toHaveBeenCalledWith("ws_sync_required");
  });

  it("persists foreground execution status when the facade reports android foreground mode", async () => {
    mockGetStatus.mockResolvedValueOnce({
      registrationStatus: "registered",
      executionMode: "android_foreground_service",
      isForegroundServiceRunning: true,
      canShowPersistentNotification: true,
    });

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledWith(
      { id: "raw-db" },
      {
        registrationStatus: "registered",
        executionMode: "android_foreground_service",
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
      },
    );
  });

  it("does not re-register execution strategies when one is already active", async () => {
    mockHasCurrentStrategy.mockReturnValue(true);

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRegisterPreferredStrategy).not.toHaveBeenCalled();
  });
});
