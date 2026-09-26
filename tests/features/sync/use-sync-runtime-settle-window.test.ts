import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import * as nativeRuntime from "../../../src/infrastructure/db/native-runtime/native-runtime.helpers";
import * as bridgeConfigModule from "../../../src/features/settings/use-bridge-config";
import * as nativeForegroundSyncAdapterModule from "../../../src/features/sync/native-foreground-sync-adapter";
import * as nativeBackgroundFloorModule from "../../../src/features/sync/native-background-floor";
import * as syncFacadeModule from "../../../src/features/sync/use-sync-facade";
import * as runtimeStatusModule from "../../../src/features/sync/sync-runtime-status.helpers";
import { useSeasonSync } from "../../../src/features/sync/use-season-sync";
import { useSyncRuntime } from "../../../src/features/sync/use-sync-runtime";
import { useWebSocket } from "../../../src/features/ws/use-websocket";
import type {
  SyncExecutionStatus,
  SyncExecutionStrategy,
} from "../../../src/features/sync/sync-execution-strategy.types";

/**
 * Upper bound of the settle window the runtime may take before it re-reads the persisted status.
 * The production delay is a single short timer (~1-2 s); the tests advance PAST the budget instead
 * of importing the value, so retuning the delay cannot silently stop guarding the re-read.
 */
const SETTLE_BUDGET_MS = 2_000;

/**
 * Live native facts the two strategies read. A test flips them to model the asynchronous
 * settle: registration only REQUESTS the foreground-service start, and the WorkManager enqueue
 * confirms later, so both can be false at the moment the runtime reads the status after
 * registering.
 */
const nativeFacts = {
  isForegroundServiceUp: false,
  isNativeFloorRegistered: false,
};

/** The persisted row once BOTH native paths have actually settled. */
const SETTLED_PROJECTION = {
  registrationStatus: "registered",
  executionMode: "android_foreground_service",
  isForegroundServiceRunning: true,
  canShowPersistentNotification: true,
  isBackgroundTaskRegistered: true,
};

/** Captured `AppState` listeners the mocked `addEventListener` registers, driven via `emitAppState`. */
const appStateListeners: ((status: string) => void)[] = [];

/**
 * Gate the next status READ waits on, set by `stallNextStatusRead`. Used to keep one projection in
 * flight across another write, which is the ordering hazard under test.
 */
let statusReadGate: Promise<void> | null = null;

/**
 * Gate the next REGISTRATION waits on, set by `stallNextRegistration`. Used to prove the settle
 * window is measured from registration resolving, not from the request.
 */
let registrationGate: Promise<void> | null = null;

/** Makes the next foreground status read block until the returned release function is called. */
function stallNextStatusRead() {
  let release = () => undefined;
  statusReadGate = new Promise<void>((resolve) => {
    release = () => {
      statusReadGate = null;
      resolve();
    };
  });

  return release;
}

/** Makes the next registration block until the returned release function is called. */
function stallNextRegistration() {
  let release = () => undefined;
  registrationGate = new Promise<void>((resolve) => {
    release = () => {
      registrationGate = null;
      resolve();
    };
  });

  return release;
}

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
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock("../../../src/features/settings/use-bridge-config", () => ({
  useBridgeConfig: jest.fn(),
}));

jest.mock("../../../src/features/sync/use-sync-facade", () => ({
  useSyncFacade: jest.fn(),
}));

// The two STRATEGIES are the seam mocked here, never the execution facade: these tests exercise
// the REAL `createSyncExecutionFacade` and its real merge, which is the behavior under test. Each
// strategy double derives its `registrationStatus` and its live boolean from ONE shared read,
// exactly as the production adapters do (`native-foreground-sync-adapter.helpers.ts` reads the
// notification presence once; `SyncFloorScheduler.status` reads `isRegistered` once).
jest.mock("../../../src/features/sync/native-foreground-sync-adapter", () => ({
  createNativeForegroundSyncAdapter: jest.fn(),
}));

jest.mock("../../../src/features/sync/native-background-floor", () => ({
  createNativeBackgroundFloorStrategy: jest.fn(),
}));

jest.mock(
  "../../../src/infrastructure/db/native-runtime/native-runtime.helpers",
  () => ({ useOptionalSQLiteContext: jest.fn() }),
);

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

/** Drains the runtime's post-registration microtask chain (register -> status -> persist) under `act`. */
async function flushRuntime() {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Builds the FGS strategy double. Its registration status and its `isForegroundServiceRunning`
 * flag come from the SAME live read, so the pair can never contradict itself -- and
 * `canShowPersistentNotification` stays true after the granted permission even while the service
 * is not up, which is the exact combination the device row carried.
 */
function buildForegroundStrategy(): SyncExecutionStrategy {
  return {
    mode: "android_foreground_service",
    register: jest.fn(async () => {
      if (registrationGate) {
        await registrationGate;
      }
    }),
    unregister: jest.fn(async () => undefined),
    getStatus: jest.fn(async (): Promise<SyncExecutionStatus> => {
      if (statusReadGate) {
        await statusReadGate;
      }

      return {
        registrationStatus: nativeFacts.isForegroundServiceUp
          ? "registered"
          : "unregistered",
        executionMode: "android_foreground_service",
        isForegroundServiceRunning: nativeFacts.isForegroundServiceUp,
        canShowPersistentNotification: true,
        isBackgroundTaskRegistered: false,
        isBatteryOptimizationExempt: false,
      };
    }),
  };
}

/**
 * Builds the native-floor strategy double, whose `registrationStatus` and
 * `isBackgroundTaskRegistered` both come from the single `isNativeFloorRegistered` read -- the
 * same one-read derivation `SyncFloorScheduler.status` performs natively.
 */
function buildFloorStrategy(): SyncExecutionStrategy {
  return {
    mode: "best_effort_background_task",
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
    getStatus: jest.fn(
      async (): Promise<SyncExecutionStatus> => ({
        registrationStatus: nativeFacts.isNativeFloorRegistered
          ? "registered"
          : "unregistered",
        executionMode: "best_effort_background_task",
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: nativeFacts.isNativeFloorRegistered,
        isBatteryOptimizationExempt: false,
      }),
    ),
  };
}

describe("useSyncRuntime settle window and projection ordering", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateListeners.length = 0;
    AppState.currentState = "active";
    nativeFacts.isForegroundServiceUp = false;
    nativeFacts.isNativeFloorRegistered = false;
    statusReadGate = null;
    registrationGate = null;
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
    (syncFacadeModule.useSyncFacade as jest.Mock).mockReturnValue({
      connectionStatus: "idle",
      lastSyncAt: null,
      manualSync: jest.fn(),
      pendingOpsCount: 0,
      requestSync: jest.fn(async () => 1),
      syncError: null,
    });
    (
      nativeForegroundSyncAdapterModule.createNativeForegroundSyncAdapter as jest.Mock
    ).mockImplementation(() => buildForegroundStrategy());
    (
      nativeBackgroundFloorModule.createNativeBackgroundFloorStrategy as jest.Mock
    ).mockImplementation(() => buildFloorStrategy());
    (
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot as jest.Mock
    ).mockResolvedValue(undefined);
    (useSeasonSync as jest.Mock).mockReturnValue({
      clearActiveSeason: jest.fn(async () => undefined),
      isRefreshing: false,
      refreshActiveSeason: jest.fn(async () => undefined),
    });
    (useWebSocket as jest.Mock).mockImplementation(() => ({}));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps the disable verdict when an earlier status read lands after it", async () => {
    const { rerender } = renderHook(() =>
      useSyncRuntime({ isBootstrapped: true }),
    );

    await flushRuntime();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS);
    });

    // A projection starts while the runtime is enabled and stalls inside its status read...
    const releaseStatusRead = stallNextStatusRead();
    nativeFacts.isForegroundServiceUp = true;
    nativeFacts.isNativeFloorRegistered = true;

    await act(async () => {
      emitAppState("background");
      emitAppState("active");
      for (let turn = 0; turn < 12; turn += 1) {
        await Promise.resolve();
      }
    });

    // ...the user disables sync while that read is still in flight, and the disable persists the
    // honest verdict for a switched-off floor.
    (bridgeConfigModule.useBridgeConfig as jest.Mock).mockReturnValue({
      config: null,
      isConfigured: false,
      isUnpairing: false,
      error: null,
      unpair: jest.fn(),
    });

    await act(async () => {
      rerender({ isBootstrapped: true });
    });
    await flushRuntime();

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith(
      { id: "raw-db" },
      expect.objectContaining({ registrationStatus: "unregistered" }),
    );

    // The stalled read now resolves with the facts it captured while sync was still on. Without an
    // ordering guard it would overwrite the disable with `registered`, telling the user the floor
    // is live right after they switched it off.
    await act(async () => {
      releaseStatusRead();
      for (let turn = 0; turn < 12; turn += 1) {
        await Promise.resolve();
      }
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith(
      { id: "raw-db" },
      expect.objectContaining({ registrationStatus: "unregistered" }),
    );
  });

  it("measures the settle window from registration resolving, not from the request", async () => {
    const releaseRegistration = stallNextRegistration();

    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    // Registration is still in flight; the available strategy statuses can already be read.
    await act(async () => {
      for (let turn = 0; turn < 12; turn += 1) {
        await Promise.resolve();
      }
    });

    const writesWhileRegistering = (
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot as jest.Mock
    ).mock.calls.length;

    // A bounded pending-registration re-read is allowed, while the post-completion window is
    // still owed after registration eventually resolves.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS * 4);
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledTimes(writesWhileRegistering + 1);

    nativeFacts.isForegroundServiceUp = true;
    nativeFacts.isNativeFloorRegistered = true;

    await act(async () => {
      releaseRegistration();
      for (let turn = 0; turn < 12; turn += 1) {
        await Promise.resolve();
      }
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS);
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith({ id: "raw-db" }, SETTLED_PROJECTION);
  });

  it("still settles when a projection dependency changes inside the settle window", async () => {
    const { rerender } = renderHook(() =>
      useSyncRuntime({ isBootstrapped: true }),
    );

    await flushRuntime();

    nativeFacts.isForegroundServiceUp = true;
    nativeFacts.isNativeFloorRegistered = true;

    // Halfway through the window the runtime's database handle changes identity (a re-open), which
    // tears the projection effect down and re-runs it with a strategy already current. Dropping
    // the owed settle pass there would leave the stale row in place until the next app resume.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS / 2);
      (nativeRuntime.useOptionalSQLiteContext as jest.Mock).mockReturnValue({
        id: "raw-db-2",
      });
      rerender({ isBootstrapped: true });
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS);
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith({ id: "raw-db-2" }, SETTLED_PROJECTION);
  });

});
