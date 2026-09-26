import { createNativeBackgroundFloorStrategy } from "../../../src/features/sync/native-background-floor";
import type { NativeBackgroundFloorModule } from "../../../src/features/sync/native-background-floor/native-background-floor.types";

// The RETIRED JS floor this seam used to be guarded against (the Expo task registration and the JS
// cycle behind it) no longer exists: `background-sync.task.ts` and `background-sync.helpers.ts` are
// deleted with the rest of the JS background scaffolding. The tripwire mocks that asserted the
// native seam never reached for them are therefore gone too -- a regression cannot even import the
// retired modules now, which is a stronger guarantee than the assertion was.

/**
 * Builds a native module double whose three floor operations all resolve [payload]. Each one
 * stays reachable as a `jest.Mock` so a test can assert it was called and steer its answer.
 */
function buildNativeFloorModule(payload: unknown): NativeBackgroundFloorModule & {
  readonly registerBackgroundSyncFloor: jest.Mock;
  readonly unregisterBackgroundSyncFloor: jest.Mock;
  readonly getBackgroundSyncFloorStatus: jest.Mock;
} {
  return {
    registerBackgroundSyncFloor: jest.fn().mockResolvedValue(payload),
    unregisterBackgroundSyncFloor: jest.fn().mockResolvedValue(payload),
    getBackgroundSyncFloorStatus: jest.fn().mockResolvedValue(payload),
  };
}

/**
 * Creates the strategy over a module double directly, bypassing the lazy default loader so each
 * test controls exactly what `requireOptionalNativeModule` would answer at runtime.
 */
function createStrategyWithModule(
  nativeModule: NativeBackgroundFloorModule | null,
) {
  return createNativeBackgroundFloorStrategy({
    requireOptionalNativeModule: () => nativeModule,
  });
}

describe("native background floor strategy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers through the native floor operation and reports the native registration", async () => {
    const nativeModule = buildNativeFloorModule({
      registrationStatus: "registered",
      isBackgroundTaskRegistered: true,
      ownsBackground: false,
    });
    const strategy = createStrategyWithModule(nativeModule);

    await strategy.register();

    expect(nativeModule.registerBackgroundSyncFloor).toHaveBeenCalledTimes(1);
    expect(nativeModule.unregisterBackgroundSyncFloor).not.toHaveBeenCalled();
    expect(await strategy.getStatus()).toEqual({
      registrationStatus: "registered",
      executionMode: "best_effort_background_task",
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isBackgroundTaskRegistered: true,
      isBatteryOptimizationExempt: false,
    });
  });

  it("cancels through the native floor operation, which retires both native and legacy work", async () => {
    const nativeModule = buildNativeFloorModule({
      registrationStatus: "unregistered",
      isBackgroundTaskRegistered: false,
      ownsBackground: false,
    });
    const strategy = createStrategyWithModule(nativeModule);

    await strategy.unregister();

    expect(nativeModule.unregisterBackgroundSyncFloor).toHaveBeenCalledTimes(1);
    expect(nativeModule.registerBackgroundSyncFloor).not.toHaveBeenCalled();
  });

  it("reports unsupported and runs no JS floor when the native module is missing", async () => {
    const strategy = createStrategyWithModule(null);

    await strategy.register();
    await strategy.unregister();
    const status = await strategy.getStatus();

    expect(status.registrationStatus).toBe("unsupported");
    expect(status.isBackgroundTaskRegistered).toBe(false);
  });

  it("never rejects: a failing native operation resolves as unsupported", async () => {
    const nativeModule = buildNativeFloorModule(null);
    nativeModule.registerBackgroundSyncFloor.mockRejectedValue(
      new Error("bridge not ready"),
    );
    nativeModule.getBackgroundSyncFloorStatus.mockRejectedValue(
      new Error("bridge not ready"),
    );
    const strategy = createStrategyWithModule(nativeModule);

    await expect(strategy.register()).resolves.toBeUndefined();
    await expect(strategy.getStatus()).resolves.toMatchObject({
      registrationStatus: "unsupported",
      isBackgroundTaskRegistered: false,
    });
  });

  it("normalizes a foreign native payload into the closed registration vocabulary", async () => {
    const strategy = createStrategyWithModule(
      buildNativeFloorModule({
        registrationStatus: 42,
        isBackgroundTaskRegistered: "true",
        ownsBackground: 1,
      }),
    );

    const status = await strategy.getStatus();

    expect(status.registrationStatus).toBe("unsupported");
    expect(status.isBackgroundTaskRegistered).toBe(false);
  });

  it("keeps the native floor's own unregistered answer distinguishable from unsupported", async () => {
    const strategy = createStrategyWithModule(
      buildNativeFloorModule({
        registrationStatus: "unregistered",
        isBackgroundTaskRegistered: false,
        ownsBackground: false,
      }),
    );

    const status = await strategy.getStatus();

    expect(status.registrationStatus).toBe("unregistered");
    expect(status.isBackgroundTaskRegistered).toBe(false);
  });
});
