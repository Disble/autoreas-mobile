import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import * as nativeRuntime from "../../../src/infrastructure/db/native-runtime/native-runtime.helpers";
import * as bridgeConfigModule from "../../../src/features/settings/use-bridge-config";
import * as syncExecutionFacadeModule from "../../../src/features/sync/sync-execution-facade";
import * as nativeBackgroundFloorModule from "../../../src/features/sync/native-background-floor";
import * as syncFacadeModule from "../../../src/features/sync/use-sync-facade";
import * as runtimeStatusModule from "../../../src/features/sync/sync-runtime-status.helpers";
import { useSeasonSync } from "../../../src/features/sync/use-season-sync";
import { useSyncRuntime } from "../../../src/features/sync/use-sync-runtime";
import { useRemoteChangeDrain } from "../../../src/features/sync/use-remote-change-drain";
import { useWebSocket } from "../../../src/features/ws/use-websocket";
import type { SyncExecutionStatus } from "../../../src/features/sync/sync-execution-strategy.types";

/** Captured `AppState` listeners the mocked `addEventListener` registers, driven via `emitAppState`. */
const appStateListeners: ((status: string) => void)[] = [];
/** Captured network-state listeners driven via `emitNetworkState`. */
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

// The native floor strategy is the registration/deregistration source the runtime wires into the execution facade: its three operations are mocked here and asserted by identity afterwards.
jest.mock("../../../src/features/sync/native-background-floor", () => ({
  createNativeBackgroundFloorStrategy: jest.fn(),
}));

jest.mock("../../../src/features/sync/sync-execution-facade", () => ({
  createSyncExecutionFacade: jest.fn(),
}));

jest.mock("../../../src/infrastructure/db/native-runtime/native-runtime.helpers", () => ({
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

jest.mock("../../../src/features/sync/use-season-sync", () => ({
  useSeasonSync: jest.fn(),
}));

jest.mock("../../../src/features/sync/use-foreground-resync", () => ({
  useForegroundResync: jest.fn(),
}));

/** Notifies every captured `AppState` listener of a state transition. */
function emitAppState(status: string) {
  appStateListeners.forEach((listener) => {
    listener(status);
  });
}

/** Notifies every captured network-state listener of a connectivity transition. */
function emitNetworkState(isConnected: boolean | null | undefined) {
  networkListeners.forEach((listener) => {
    listener({ isConnected });
  });
}

/** Builds the execution status the mocked facade reports, with per-test overrides. */
function buildStatus(
  overrides: Partial<SyncExecutionStatus> = {},
): Omit<SyncExecutionStatus, "isBatteryOptimizationExempt"> {
  return {
    registrationStatus: "registered",
    executionMode: "best_effort_background_task",
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    isBackgroundTaskRegistered: true,
    ...overrides,
  };
}

describe("useSyncRuntime", () => {
  const mockRequestSync = jest.fn();
  const mockRegisterConcurrentStrategies = jest.fn();
  const mockHasCurrentStrategy = jest.fn();
  const mockUnregisterCurrentStrategy = jest.fn();
  const mockGetStatus = jest.fn();
  const mockNativeFloorRegister = jest.fn();
  const mockNativeFloorUnregister = jest.fn();
  const mockNativeFloorGetStatus = jest.fn();
  const mockRefreshActiveSeason = jest.fn();
  const mockClearActiveSeason = jest.fn();

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
    mockRegisterConcurrentStrategies.mockResolvedValue(undefined);
    mockHasCurrentStrategy.mockReturnValue(false);
    mockUnregisterCurrentStrategy.mockResolvedValue(undefined);
    mockGetStatus.mockResolvedValue(buildStatus());
    (
      syncExecutionFacadeModule.createSyncExecutionFacade as jest.Mock
    ).mockReturnValue({
      registerConcurrentStrategies: mockRegisterConcurrentStrategies,
      hasCurrentStrategy: mockHasCurrentStrategy,
      unregisterCurrentStrategy: mockUnregisterCurrentStrategy,
      getStatus: mockGetStatus,
    });
    (
      nativeBackgroundFloorModule.createNativeBackgroundFloorStrategy as jest.Mock
    ).mockReturnValue({
      mode: "best_effort_background_task",
      register: mockNativeFloorRegister,
      unregister: mockNativeFloorUnregister,
      getStatus: mockNativeFloorGetStatus,
    });
    (
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot as jest.Mock
    ).mockResolvedValue(undefined);
    mockRefreshActiveSeason.mockResolvedValue(undefined);
    mockClearActiveSeason.mockResolvedValue(undefined);
    (useSeasonSync as jest.Mock).mockReturnValue({
      clearActiveSeason: mockClearActiveSeason,
      isRefreshing: false,
      refreshActiveSeason: mockRefreshActiveSeason,
    });
    (useWebSocket as jest.Mock).mockImplementation(() => ({}));
  });

  it("boots the paired runtime from root, registers background sync, and owns websocket wiring", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRegisterConcurrentStrategies).toHaveBeenCalledTimes(1);

    // The registration source is the native floor strategy -- the retired Expo task no longer exists to be registered or queried here.
    const floorStrategy = (
      syncExecutionFacadeModule.createSyncExecutionFacade as jest.Mock
    ).mock.calls.at(-1)?.[0].strategies.at(-1);

    expect(floorStrategy.mode).toBe("best_effort_background_task");
    expect(floorStrategy.register).toBe(mockNativeFloorRegister);
    expect(floorStrategy.unregister).toBe(mockNativeFloorUnregister);
    expect(floorStrategy.getStatus).toBe(mockNativeFloorGetStatus);
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledWith({ id: "raw-db" }, buildStatus());
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
    mockGetStatus.mockResolvedValueOnce(
      // The REAL facade has already released every strategy by the time this read happens, so its
      // only answer is the pre-registration fallback `unsupported` ("this host cannot register a
      // floor at all"). A mock that answered `unregistered` here would satisfy the assertion below
      // on its own and stop guarding the disable-path override.
      buildStatus({
        registrationStatus: "unsupported",
        isBackgroundTaskRegistered: false,
      }),
    );

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUnregisterCurrentStrategy).toHaveBeenCalledTimes(1);
    // The native floor's own cancel is the only floor cancel on the disable path: it retires both the native periodic request and the pre-native `EXPO_BACKGROUND_WORKER` unique work, so no separate JS unregister is needed (there is no JS floor left).
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledWith(
      { id: "raw-db" },
      buildStatus({
        registrationStatus: "unregistered",
        isBackgroundTaskRegistered: false,
      }),
    );
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

  it("keeps websocket season mode and candidate data on one transition path", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    const webSocketArgs = (useWebSocket as jest.Mock).mock.calls.at(-1)?.[0];

    mockRefreshActiveSeason.mockClear();
    mockClearActiveSeason.mockClear();

    await act(async () => {
      await webSocketArgs.onPreferencesChanged(true);
      await Promise.resolve();
    });

    expect(mockRefreshActiveSeason).toHaveBeenCalledTimes(1);
    expect(mockClearActiveSeason).not.toHaveBeenCalled();

    mockRefreshActiveSeason.mockClear();

    await act(async () => {
      await webSocketArgs.onPreferencesChanged(false);
      await Promise.resolve();
    });

    expect(mockRefreshActiveSeason).not.toHaveBeenCalled();
    expect(mockClearActiveSeason).toHaveBeenCalledTimes(1);
  });

  it("swallows a refreshActiveSeason/clearActiveSeason rejection instead of surfacing an unhandled rejection", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    const webSocketArgs = (useWebSocket as jest.Mock).mock.calls.at(-1)?.[0];

    mockRefreshActiveSeason.mockRejectedValueOnce(new Error("season refresh failed"));
    await act(async () => {
      webSocketArgs.onPreferencesChanged(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    mockClearActiveSeason.mockRejectedValueOnce(new Error("season clear failed"));
    await act(async () => {
      webSocketArgs.onPreferencesChanged(false);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("refreshes the active season when the websocket reports the season itself changed", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    const webSocketArgs = (useWebSocket as jest.Mock).mock.calls.at(-1)?.[0];
    mockRefreshActiveSeason.mockClear();

    await act(async () => {
      webSocketArgs.onSeasonChanged();
      await Promise.resolve();
    });

    expect(mockRefreshActiveSeason).toHaveBeenCalledTimes(1);
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
    mockGetStatus.mockResolvedValueOnce(
      buildStatus({
        executionMode: "android_foreground_service",
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
      }),
    );

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledWith(
      { id: "raw-db" },
      buildStatus({
        executionMode: "android_foreground_service",
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
      }),
    );
  });

  it("does not re-register execution strategies when one is already active", async () => {
    mockHasCurrentStrategy.mockReturnValue(true);

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRegisterConcurrentStrategies).not.toHaveBeenCalled();
  });

  // There is deliberately no `unsupported` case here. `registrationStatus` is the execution
  // facade's merged verdict -- `registered`/`unregistered`/`unsupported` are decided by that merge,
  // not by this hook -- and this hook only persists whatever the facade answers (the boot test
  // above already covers the pass-through). A test with a MOCKED facade feeding `unsupported` would
  // assert the mock, not the product: the real merge, including the case where every registered
  // strategy reports `unsupported`, is covered in tests/features/sync/sync-execution-facade.test.ts
  // against the real facade.
});
