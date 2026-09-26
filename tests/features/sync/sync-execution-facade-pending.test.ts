import { createSyncExecutionFacade } from '../../../src/features/sync/sync-execution-facade';
import type { SyncExecutionStrategy } from '../../../src/features/sync/sync-execution-strategy.types';

/** Creates a controllable asynchronous registration boundary. */
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Models a native status probe that stays readable while registration is pending. */
function strategy(mode: SyncExecutionStrategy['mode'], running: boolean, pending: Promise<void>): SyncExecutionStrategy {
  return {
    mode,
    register: jest.fn(() => pending),
    unregister: jest.fn(async () => undefined),
    getStatus: jest.fn(async () => ({
      registrationStatus: running ? 'registered' as const : 'unregistered' as const,
      executionMode: mode,
      isForegroundServiceRunning: mode === 'android_foreground_service' && running,
      canShowPersistentNotification: mode === 'android_foreground_service',
      isBackgroundTaskRegistered: mode === 'best_effort_background_task' && running,
      isBatteryOptimizationExempt: false,
    })),
  };
}

describe('concurrent registration while a path is pending', () => {
  it.each([
    ['android_foreground_service', 'best_effort_background_task'],
    ['best_effort_background_task', 'android_foreground_service'],
  ] as const)('keeps the live %s path readable while %s registration is pending', async (liveMode, pendingMode) => {
    const gate = deferred();
    const live = strategy(liveMode, true, Promise.resolve());
    const pending = strategy(pendingMode, false, gate.promise);
    const facade = createSyncExecutionFacade({ strategies: [live, pending] });

    const registration = facade.registerConcurrentStrategies();
    expect(facade.hasCurrentStrategy()).toBe(true);
    await expect(facade.getStatus()).resolves.toMatchObject({
      registrationStatus: 'registered',
      isForegroundServiceRunning: liveMode === 'android_foreground_service',
      isBackgroundTaskRegistered: liveMode === 'best_effort_background_task',
    });
    gate.resolve();
    await registration;
  });

  it('does not resurrect a path after disable while registration is pending', async () => {
    const gate = deferred();
    const foreground: SyncExecutionStrategy = {
      ...strategy('android_foreground_service', true, gate.promise),
      register: jest.fn(async () => {
        await gate.promise;
        nativeRegistered = true;
      }),
      unregister: jest.fn(async () => { nativeRegistered = false; }),
    };
    const floor = strategy('best_effort_background_task', false, Promise.resolve());
    let nativeRegistered = false;
    const facade = createSyncExecutionFacade({ strategies: [foreground, floor] });

    const registration = facade.registerConcurrentStrategies();
    await facade.unregisterCurrentStrategy();
    expect(foreground.unregister).toHaveBeenCalledTimes(1);
    expect(floor.unregister).toHaveBeenCalled();
    gate.resolve();
    await registration;

    expect(nativeRegistered).toBe(false);
    expect(facade.hasCurrentStrategy()).toBe(false);
    await expect(facade.getStatus()).resolves.toMatchObject({ registrationStatus: 'unsupported' });
  });

  it('does not cancel a newly enabled path when an older registration finishes late', async () => {
    const first = deferred();
    let calls = 0;
    const foreground: SyncExecutionStrategy = {
      ...strategy('android_foreground_service', true, Promise.resolve()),
      register: jest.fn(() => (++calls === 1 ? first.promise : Promise.resolve())),
    };
    const facade = createSyncExecutionFacade({ strategies: [foreground] });

    const oldRegistration = facade.registerConcurrentStrategies();
    await facade.unregisterCurrentStrategy();
    await facade.registerConcurrentStrategies();
    const cancellationsBeforeOldCompletion = (foreground.unregister as jest.Mock).mock.calls.length;
    first.resolve();
    await oldRegistration;

    expect(facade.hasCurrentStrategy()).toBe(true);
    expect(foreground.unregister).toHaveBeenCalledTimes(cancellationsBeforeOldCompletion);
  });
});
