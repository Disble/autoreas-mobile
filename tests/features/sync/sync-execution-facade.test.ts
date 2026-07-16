import { createSyncExecutionFacade } from '../../../src/features/sync/sync-execution-facade';
import type { SyncExecutionStrategy } from '../../../src/features/sync/sync-execution-strategy.types';

function createStrategy(
  mode: SyncExecutionStrategy['mode'],
  registrationStatus: 'registered' | 'unregistered' | 'unsupported',
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
});
