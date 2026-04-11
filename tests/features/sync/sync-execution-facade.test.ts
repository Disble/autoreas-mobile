import { createSyncExecutionFacade } from '../../../src/features/sync/sync-execution-facade';
import type { SyncExecutionStrategy } from '../../../src/features/sync/sync-execution-strategy.types';

function createStrategy(
  mode: SyncExecutionStrategy['mode'],
  registrationStatus: 'registered' | 'unregistered' | 'unsupported',
): SyncExecutionStrategy {
  return {
    mode,
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
    getStatus: jest.fn(async () => ({
      registrationStatus,
      executionMode: mode,
      isForegroundServiceRunning: mode === 'android_foreground_service',
      canShowPersistentNotification: mode === 'android_foreground_service',
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
});
