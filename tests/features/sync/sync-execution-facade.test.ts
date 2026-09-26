import { createSyncExecutionFacade } from '../../../src/features/sync/sync-execution-facade';
import { createNativeBackgroundFloorStrategy } from '../../../src/features/sync/native-background-floor';
import type { NativeBackgroundFloorModule } from '../../../src/features/sync/native-background-floor/native-background-floor.types';
import type {
  SyncExecutionStatus,
  SyncExecutionStrategy,
} from '../../../src/features/sync/sync-execution-strategy.types';

/** Builds a stub `SyncExecutionStrategy` reporting the given mode/status/exemption. */
function createStrategy(
  mode: SyncExecutionStrategy['mode'],
  registrationStatus: 'registered' | 'unregistered' | 'unsupported',
  isBatteryOptimizationExempt = false,
): SyncExecutionStrategy {
  const isForegroundServiceRunning =
    mode === 'android_foreground_service' && registrationStatus === 'registered';
  const isBackgroundTaskRegistered =
    mode === 'best_effort_background_task' && registrationStatus === 'registered';

  return {
    mode,
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
    getStatus: jest.fn(async () => ({
      registrationStatus,
      executionMode: mode,
      isForegroundServiceRunning,
      canShowPersistentNotification: isForegroundServiceRunning,
      isBackgroundTaskRegistered,
      isBatteryOptimizationExempt,
    })),
  };
}

describe('sync-execution-facade', () => {
  it('selects the first registered strategy and exposes its status', async () => {
    const bestEffort = createStrategy('best_effort_background_task', 'registered');
    const foreground = createStrategy('android_foreground_service', 'registered');

    const facade = createSyncExecutionFacade({
      strategies: [foreground, bestEffort],
    });

    expect(facade.hasCurrentStrategy()).toBe(false);

    await facade.registerPreferredStrategy();

    expect(facade.hasCurrentStrategy()).toBe(true);

    await expect(facade.getStatus()).resolves.toEqual({
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: true,
      canShowPersistentNotification: true,
      isBackgroundTaskRegistered: false,
      isBatteryOptimizationExempt: false,
    });
  });

  it('reports the safe fallback status before any strategy registers', async () => {
    const foreground = createStrategy('android_foreground_service', 'unregistered');

    const facade = createSyncExecutionFacade({
      strategies: [foreground],
    });

    await expect(facade.getStatus()).resolves.toEqual({
      registrationStatus: 'unsupported',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isBackgroundTaskRegistered: false,
      isBatteryOptimizationExempt: false,
    });
  });

  it('falls back to best-effort when the preferred strategy is unsupported', async () => {
    const unsupportedForeground = createStrategy('android_foreground_service', 'unsupported');
    const bestEffort = createStrategy('best_effort_background_task', 'registered');

    const facade = createSyncExecutionFacade({
      strategies: [unsupportedForeground, bestEffort],
    });

    await facade.registerPreferredStrategy();

    expect(bestEffort.register).toHaveBeenCalledTimes(1);
    await expect(facade.getStatus()).resolves.toEqual({
      registrationStatus: 'registered',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isBackgroundTaskRegistered: true,
      isBatteryOptimizationExempt: false,
    });
  });

  it('does not re-register when a current strategy already exists', async () => {
    const foreground = createStrategy('android_foreground_service', 'registered');

    const facade = createSyncExecutionFacade({
      strategies: [foreground],
    });

    await facade.registerPreferredStrategy();
    await facade.registerPreferredStrategy();

    expect(foreground.register).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last strategy when none reports registered, rather than leaving no current strategy', async () => {
    const foreground = createStrategy('android_foreground_service', 'unsupported');
    const bestEffort = createStrategy('best_effort_background_task', 'unregistered');

    const facade = createSyncExecutionFacade({
      strategies: [foreground, bestEffort],
    });

    await facade.registerPreferredStrategy();

    expect(facade.hasCurrentStrategy()).toBe(true);
    await expect(facade.getStatus()).resolves.toMatchObject({
      executionMode: 'best_effort_background_task',
    });
  });

  it('unregisters the single preferred strategy, and no-ops when nothing is currently registered', async () => {
    const foreground = createStrategy('android_foreground_service', 'registered');

    const facade = createSyncExecutionFacade({
      strategies: [foreground],
    });

    await facade.unregisterCurrentStrategy();
    expect(foreground.unregister).not.toHaveBeenCalled();

    await facade.registerPreferredStrategy();
    await facade.unregisterCurrentStrategy();

    expect(foreground.unregister).toHaveBeenCalledTimes(1);
    expect(facade.hasCurrentStrategy()).toBe(false);
  });

  describe('registerConcurrentStrategies', () => {
    it('registers both the WorkManager floor and the FGS primary independently, never leaving zero paths', async () => {
      const foreground = createStrategy('android_foreground_service', 'registered');
      const bestEffort = createStrategy('best_effort_background_task', 'registered');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();

      expect(foreground.register).toHaveBeenCalledTimes(1);
      expect(bestEffort.register).toHaveBeenCalledTimes(1);
      expect(facade.hasCurrentStrategy()).toBe(true);

      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'registered',
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
        isBackgroundTaskRegistered: true,
        isBatteryOptimizationExempt: false,
      });
    });

    it('keeps the WorkManager floor registered when the FGS primary fails to register (honest executionMode, no zero paths)', async () => {
      const foreground = createStrategy('android_foreground_service', 'unregistered');
      const bestEffort = createStrategy('best_effort_background_task', 'registered');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();

      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: true,
        isBatteryOptimizationExempt: false,
      });
    });

    it('OR-merges the battery-optimization exemption so one strategy reporting it does not get dropped', async () => {
      const foreground = createStrategy('android_foreground_service', 'registered', true);
      const bestEffort = createStrategy('best_effort_background_task', 'registered', false);

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();

      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'registered',
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
        isBackgroundTaskRegistered: true,
        isBatteryOptimizationExempt: true,
      });
    });

    it('does not re-register when concurrent strategies are already active', async () => {
      const foreground = createStrategy('android_foreground_service', 'registered');
      const bestEffort = createStrategy('best_effort_background_task', 'registered');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();
      await facade.registerConcurrentStrategies();

      expect(foreground.register).toHaveBeenCalledTimes(1);
      expect(bestEffort.register).toHaveBeenCalledTimes(1);
    });

    it('unregisters both paths on unregisterCurrentStrategy so neither remains active', async () => {
      const foreground = createStrategy('android_foreground_service', 'registered');
      const bestEffort = createStrategy('best_effort_background_task', 'registered');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();
      await facade.unregisterCurrentStrategy();

      expect(foreground.unregister).toHaveBeenCalledTimes(1);
      expect(bestEffort.unregister).toHaveBeenCalledTimes(1);
      expect(facade.hasCurrentStrategy()).toBe(false);
    });
  });

  // The merged verdict is the value settings persists, so these run against the REAL facade and its
  // real merge. `unsupported` says "this host cannot register a floor at all" and must not be
  // rewritten into `unregistered`, which says "the floor is switched off" -- the two call for
  // different user-facing answers.
  describe('concurrent registration verdict', () => {
    it('reports unsupported when every concurrent strategy reports unsupported', async () => {
      const foreground = createStrategy('android_foreground_service', 'unsupported');
      const bestEffort = createStrategy('best_effort_background_task', 'unsupported');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();

      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'unsupported',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: false,
        isBatteryOptimizationExempt: false,
      });
    });

    it('reports registered when one path is registered and another reports unsupported', async () => {
      const foreground = createStrategy('android_foreground_service', 'unsupported');
      const bestEffort = createStrategy('best_effort_background_task', 'registered');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();

      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'registered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: true,
        isBatteryOptimizationExempt: false,
      });
    });

    it('reports unregistered when a path answers unregistered even though another reports unsupported', async () => {
      const foreground = createStrategy('android_foreground_service', 'unsupported');
      const bestEffort = createStrategy('best_effort_background_task', 'unregistered');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, bestEffort],
      });

      await facade.registerConcurrentStrategies();

      await expect(facade.getStatus()).resolves.toMatchObject({
        registrationStatus: 'unregistered',
        isForegroundServiceRunning: false,
        isBackgroundTaskRegistered: false,
      });
    });

    it('preserves the real native floor strategy unsupported answer when it is the only registered path', async () => {
      const nativeFloor = createNativeBackgroundFloorStrategy({
        requireOptionalNativeModule: () => null,
      });

      const facade = createSyncExecutionFacade({ strategies: [nativeFloor] });

      await facade.registerConcurrentStrategies();

      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'unsupported',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: false,
        isBatteryOptimizationExempt: false,
      });
    });

    it('reports unregistered for the Android pairing, because the FGS strategy answers a real lifecycle state', async () => {
      // The production Android pairing: the real native floor seam (no native module on this host)
      // plus the FGS strategy. The FGS adapter is stood in for by an equivalent `unregistered`
      // stub -- it has its own adapter tests, and importing notifee here would add noise to the
      // merge assertion. Its `unregistered` is a genuine lifecycle answer, so it wins over the
      // floor's `unsupported`: on Android the missing-module reason is NOT surfaced while the FGS
      // path exists. That is honest -- something IS off, just not "unsupportable" -- and it is the
      // boundary that keeps `unsupported` from swallowing every device that merely has the floor
      // switched off.
      const nativeFloor = createNativeBackgroundFloorStrategy({
        requireOptionalNativeModule: () => null,
      });
      const foreground = createStrategy('android_foreground_service', 'unregistered');

      const facade = createSyncExecutionFacade({
        strategies: [foreground, nativeFloor],
      });

      await facade.registerConcurrentStrategies();

      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'unregistered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: false,
        isBackgroundTaskRegistered: false,
        isBatteryOptimizationExempt: false,
      });
    });
  });

  // The S1 mapping RULED OUT the merge as the defect's cause, and this block pins both halves of
  // that conclusion instead of asserting a contradiction the real seams cannot produce. (1) Every
  // production strategy derives `registrationStatus` and its live boolean from the SAME native
  // read -- `isForegroundServiceRunning` in the FGS adapter, `isRegistered` in
  // `SyncFloorScheduler.status` -- so no real seam pairs a `registered` verdict with two false
  // flags, and the merge's `isAnyPathRegistered` preference therefore never overrides an honest
  // strategy answer. (2) The facade caches no verdict: asking the SAME facade again after the
  // native side settles returns the corrected values, which is exactly what the runtime relies on
  // when it re-projects the row.
  describe('live re-read after the native side settles', () => {
    it('reports the corrected verdict when the same facade is asked again once the enqueue and the service are up', async () => {
      let isFloorRegistered = false;
      let isForegroundServiceUp = false;
      const nativeModule: NativeBackgroundFloorModule = {
        registerBackgroundSyncFloor: jest.fn(async () => ({
          registrationStatus: 'registered',
          isBackgroundTaskRegistered: true,
          ownsBackground: false,
        })),
        unregisterBackgroundSyncFloor: jest.fn(async () => ({
          registrationStatus: 'unregistered',
          isBackgroundTaskRegistered: false,
          ownsBackground: false,
        })),
        getBackgroundSyncFloorStatus: jest.fn(async () => ({
          registrationStatus: isFloorRegistered ? 'registered' : 'unregistered',
          isBackgroundTaskRegistered: isFloorRegistered,
          ownsBackground: false,
        })),
      };
      const nativeFloor = createNativeBackgroundFloorStrategy({
        requireOptionalNativeModule: () => nativeModule,
      });
      // One-read FGS stand-in: registration status and live flag mirror each other exactly as the
      // real adapter derives them from its single presence probe, and the granted permission
      // stays true while the service is still starting -- the pair the device row carried.
      const foreground: SyncExecutionStrategy = {
        mode: 'android_foreground_service',
        register: jest.fn(async () => undefined),
        unregister: jest.fn(async () => undefined),
        getStatus: jest.fn(
          async (): Promise<SyncExecutionStatus> => ({
            registrationStatus: isForegroundServiceUp ? 'registered' : 'unregistered',
            executionMode: 'android_foreground_service',
            isForegroundServiceRunning: isForegroundServiceUp,
            canShowPersistentNotification: true,
            isBackgroundTaskRegistered: false,
            isBatteryOptimizationExempt: false,
          }),
        ),
      };

      const facade = createSyncExecutionFacade({
        strategies: [foreground, nativeFloor],
      });

      await facade.registerConcurrentStrategies();

      // The read taken while the requested service start has not confirmed yet. The merged verdict
      // is HONEST for its inputs -- both paths really are down at that instant -- which is why
      // this row is unreachable as the merge's fault and reachable only as a staleness fault.
      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'unregistered',
        executionMode: 'best_effort_background_task',
        isForegroundServiceRunning: false,
        canShowPersistentNotification: true,
        isBackgroundTaskRegistered: false,
        isBatteryOptimizationExempt: false,
      });

      isFloorRegistered = true;
      isForegroundServiceUp = true;

      // Nothing was re-registered: the same facade, asked again, reports the settled truth.
      await expect(facade.getStatus()).resolves.toEqual({
        registrationStatus: 'registered',
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning: true,
        canShowPersistentNotification: true,
        isBackgroundTaskRegistered: true,
        isBatteryOptimizationExempt: false,
      });
    });
  });
});
