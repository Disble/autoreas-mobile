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

/**
 * Upper bound of the settle window the runtime may take before it re-reads the persisted status.
 * The production delay is a single short timer (~1-2 s); the tests advance PAST the budget instead
 * of importing the value, so retuning the delay cannot silently stop guarding the re-read.
 */
const SETTLE_BUDGET_MS = 2_000;

/** Window the tests advance beyond the settle budget to prove the re-read is not a poll. */
const NO_POLL_WINDOW_MS = 10_000;

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

/** The persisted row the tablet showed: `unregistered` while the floor was enqueued and the service was still starting. */
const STALE_PROJECTION = {
  registrationStatus: "unregistered",
  executionMode: "best_effort_background_task",
  isForegroundServiceRunning: false,
  canShowPersistentNotification: true,
  isBackgroundTaskRegistered: false,
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

/** Gate the next foreground status read waits on; null means the read is not stalled. */
let statusReadGate: Promise<void> | null = null;

/** Gate the next registration waits on; null means registration is not stalled. */
let registrationGate: Promise<void> | null = null;

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

describe("useSyncRuntime status projection", () => {
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

  it("re-projects the persisted status once the asynchronous native start has had a bounded chance to settle", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await flushRuntime();

    // The read taken right after registration can only observe the state BEFORE the requested
    // foreground-service start confirmed. That stale reading is the defect's precondition: it is
    // what the tablet persisted while the floor was ENQUEUED and the service was coming up.
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith({ id: "raw-db" }, STALE_PROJECTION);

    // The native side settles AFTER that read: the service reaches `isForeground=true` and the
    // WorkManager enqueue is confirmed.
    nativeFacts.isForegroundServiceUp = true;
    nativeFacts.isNativeFloorRegistered = true;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS);
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith({ id: "raw-db" }, SETTLED_PROJECTION);
  });

  it("re-reads once rather than on a polling timer while the runtime stays mounted", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await flushRuntime();

    nativeFacts.isForegroundServiceUp = true;
    nativeFacts.isNativeFloorRegistered = true;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS + NO_POLL_WINDOW_MS);
    });

    // One write at registration plus exactly one settle re-read. A polling timer would keep
    // writing the same row for the whole window and for as long as the app stays foregrounded.
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledTimes(2);
  });

  it("re-projects the persisted status when the app returns to the foreground", async () => {
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));

    await flushRuntime();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS);
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith({ id: "raw-db" }, STALE_PROJECTION);

    // The resumed app owns live facts again: both native paths settled while it was backgrounded.
    nativeFacts.isForegroundServiceUp = true;
    nativeFacts.isNativeFloorRegistered = true;

    await act(async () => {
      emitAppState("background");
      emitAppState("active");
      for (let turn = 0; turn < 12; turn += 1) {
        await Promise.resolve();
      }
    });

    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith({ id: "raw-db" }, SETTLED_PROJECTION);
  });

  it("persists live floor status on resume while foreground registration is pending", async () => {
    let releaseRegistration: () => void = () => undefined;
    registrationGate = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    nativeFacts.isNativeFloorRegistered = true;
    renderHook(() => useSyncRuntime({ isBootstrapped: true }));
    await flushRuntime();

    await act(async () => {
      emitAppState("background");
      emitAppState("active");
      for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
    });

    expect(runtimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenLastCalledWith(
      { id: "raw-db" },
      {
        registrationStatus: "registered",
        executionMode: "best_effort_background_task",
        isForegroundServiceRunning: false,
        canShowPersistentNotification: true,
        isBackgroundTaskRegistered: true,
      },
    );
    await act(async () => {
      releaseRegistration();
      for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
    });
  });

  it("keeps the disabled verdict after pending foreground registration resolves", async () => {
    let releaseRegistration: () => void = () => undefined;
    registrationGate = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    nativeFacts.isNativeFloorRegistered = true;
    const { rerender } = renderHook(() => useSyncRuntime({ isBootstrapped: true }));
    await flushRuntime();

    (bridgeConfigModule.useBridgeConfig as jest.Mock).mockReturnValue({ isConfigured: false });
    await act(async () => { rerender({ isBootstrapped: true }); });
    await flushRuntime();

    await act(async () => {
      releaseRegistration();
      for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS);
    });
    expect(runtimeStatusModule.updateSyncRuntimeStatusSnapshot).toHaveBeenLastCalledWith(
      { id: "raw-db" }, expect.objectContaining({ registrationStatus: "unregistered" }),
    );
  });

  it("persists unregistered, not unsupported, when sync is disabled", async () => {
    const { rerender } = renderHook(() =>
      useSyncRuntime({ isBootstrapped: true }),
    );

    await flushRuntime();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SETTLE_BUDGET_MS);
    });

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

    // `unsupported` answers "this host cannot register a floor at all", which is false here: the
    // user switched the floor off. Only `unregistered` says what actually happened.
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenLastCalledWith(
      { id: "raw-db" },
      {
        registrationStatus: "unregistered",
        executionMode: "best_effort_background_task",
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: false,
      },
    );
  });

  it("cancels the bounded re-read on unmount so no timer outlives the runtime", async () => {
    const { unmount } = renderHook(() =>
      useSyncRuntime({ isBootstrapped: true }),
    );

    await flushRuntime();

    const writesBeforeUnmount = (
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot as jest.Mock
    ).mock.calls.length;

    await act(async () => {
      unmount();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(NO_POLL_WINDOW_MS);
    });

    // A leaked timer would still call the write door after the runtime is gone, writing a row for
    // a hook that no longer exists.
    expect(
      runtimeStatusModule.updateSyncRuntimeStatusSnapshot,
    ).toHaveBeenCalledTimes(writesBeforeUnmount);
  });
});
