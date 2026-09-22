import { BackgroundTaskResult } from 'expo-background-task';
import type { NativeSyncEngine } from '../../../../src/features/sync/native-sync-engine/native-sync-engine.types';

/**
 * Exercises the real background-task wiring: the defined task, the real
 * `resolveBackgroundTaskOutcome`, and the real engine-first routing inside
 * `runBackgroundSyncCycle`. Only the boundaries are mocked — the native engine seam and the JS
 * cycle's own dependencies — so each case asserts the actual routing decision this migration
 * introduces: native engine first, JS cycle as fallback.
 */
jest.mock(
  '../../../../src/features/sync/native-sync-engine/native-sync-engine.helpers',
  () => ({
    createNativeSyncEngine: jest.fn(),
    BACKGROUND_SYNC_ENGINE_TRIGGER_SOURCE: 'background_task',
  }),
);

jest.mock('../../../../src/features/sync/headless-sync-cycle.helpers', () => ({
  runHeadlessSyncCycle: jest.fn(),
}));

jest.mock('../../../../src/features/sync/sqlite-sync-runtime.helpers', () => ({
  createSyncSQLiteRuntime: jest.fn(),
}));

jest.mock('../../../../src/features/sync/sync-cycle-lock.helpers', () => ({
  withExclusiveSyncCycle: jest.fn(async (params: { run: () => Promise<void> }) =>
    params.run(),
  ),
}));

// The FGS watchdog is a separate concern from engine-vs-JS routing, and it shares
// `sqlite-sync-runtime.helpers`'s mock above -- left unmocked here, its real implementation
// would call that same `createSyncSQLiteRuntime` mock and pollute the call-count assertions
// below. Its own behaviour is covered directly in foreground-service-watchdog.helpers.test.ts.
jest.mock('../../../../src/features/sync/foreground-service-watchdog.helpers', () => ({
  runForegroundServiceWatchdog: jest.fn(),
}));

jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: {
    Failed: 'failed-result',
    Success: 'success-result',
  },
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));

/** Returns the mocked native-engine factory so a case can steer engine availability. */
function getEngineFactoryMock() {
  return jest.requireMock(
    '../../../../src/features/sync/native-sync-engine/native-sync-engine.helpers',
  ) as { createNativeSyncEngine: jest.Mock };
}

/** Returns the mocked JS headless cycle so a case can assert it ran (or never ran). */
function getJsCycleMock() {
  return jest.requireMock(
    '../../../../src/features/sync/headless-sync-cycle.helpers',
  ) as { runHeadlessSyncCycle: jest.Mock };
}

/** Returns the mocked JS runtime factory, the JS cycle path's first observable step. */
function getJsRuntimeMock() {
  return jest.requireMock(
    '../../../../src/features/sync/sqlite-sync-runtime.helpers',
  ) as { createSyncSQLiteRuntime: jest.Mock };
}

/** Returns the mocked FGS watchdog, a collaborator unrelated to this file's routing assertions. */
function getForegroundServiceWatchdogMock() {
  return jest.requireMock(
    '../../../../src/features/sync/foreground-service-watchdog.helpers',
  ) as { runForegroundServiceWatchdog: jest.Mock };
}

/**
 * Points the mocked `createNativeSyncEngine` at a stub engine with the given behaviour and
 * returns that stub so cases can assert the trigger source it received.
 */
function stubEngine(engine: Partial<NativeSyncEngine>): NativeSyncEngine {
  const stub: NativeSyncEngine = {
    runOnce: jest.fn().mockResolvedValue({
      outcome: 'closed',
      cycleId: 'cycle-1',
      syncedCount: 0,
      backlogReadCount: 0,
      stage: 'closed',
      errorName: null,
    }),
    isAvailable: () => true,
    ...engine,
  };

  getEngineFactoryMock().createNativeSyncEngine.mockReturnValue(stub);

  return stub;
}

/** Loads the task module in isolation and returns the callback it registered with the host. */
function loadDefinedTask() {
  jest.isolateModules(() => {
    jest.requireActual('../../../../src/features/sync/background-sync.task');
  });

  const taskManagerModule = jest.requireMock('expo-task-manager') as {
    defineTask: jest.Mock;
  };

  expect(taskManagerModule.defineTask).toHaveBeenCalledWith(
    'autoreas-background-sync',
    expect.any(Function),
  );

  return taskManagerModule.defineTask.mock.calls[0][1] as () => Promise<string>;
}

describe('background sync task native-engine routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    (jest.requireMock('expo-task-manager') as {
      isTaskRegisteredAsync: jest.Mock;
    }).isTaskRegisteredAsync.mockResolvedValue(false);
    getJsCycleMock().runHeadlessSyncCycle.mockResolvedValue({
      kind: 'success',
      syncedCount: 3,
    });
    getJsRuntimeMock().createSyncSQLiteRuntime.mockReturnValue({
      owner: 'headless_cycle',
      rawDb: {},
      isOpen: () => true,
      open: jest.fn().mockResolvedValue({}),
      withDatabase: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    });
    getForegroundServiceWatchdogMock().runForegroundServiceWatchdog.mockResolvedValue(
      'already_running',
    );
  });

  it('routes the attempt through the native engine when it is available', async () => {
    const engine = stubEngine({
      runOnce: jest.fn().mockResolvedValue({
        outcome: 'closed',
        cycleId: 'cycle-9',
        syncedCount: 4,
        backlogReadCount: 6,
        stage: 'closed',
        errorName: null,
      }),
    });
    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(BackgroundTaskResult.Success);

    expect(engine.runOnce).toHaveBeenCalledWith('background_task');
    expect(getJsRuntimeMock().createSyncSQLiteRuntime).not.toHaveBeenCalled();
    expect(getJsCycleMock().runHeadlessSyncCycle).not.toHaveBeenCalled();
  });

  it('falls back to the JS cycle when the native engine is unavailable', async () => {
    const engine = stubEngine({ isAvailable: () => false });
    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(BackgroundTaskResult.Success);

    expect(engine.runOnce).not.toHaveBeenCalled();
    expect(getJsRuntimeMock().createSyncSQLiteRuntime).toHaveBeenCalledTimes(1);
    expect(getJsCycleMock().runHeadlessSyncCycle).toHaveBeenCalledTimes(1);
  });

  it('falls back to the JS cycle when an available engine still answers unavailable', async () => {
    stubEngine({
      runOnce: jest.fn().mockResolvedValue({
        outcome: 'unavailable',
        cycleId: null,
        syncedCount: 0,
        backlogReadCount: 0,
        stage: null,
        errorName: null,
      }),
    });
    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(BackgroundTaskResult.Success);

    expect(getJsRuntimeMock().createSyncSQLiteRuntime).toHaveBeenCalledTimes(1);
    expect(getJsCycleMock().runHeadlessSyncCycle).toHaveBeenCalledTimes(1);
  });

  it('maps a native failed attempt onto a handled success without running the JS cycle', async () => {
    // Handled failures still resolve `Success` to the host (the existing contract: the platform
    // only re-enqueues on `Failed`, and a handled failed attempt must not be mistaken for a
    // crashed task). The assertion is that the failure did not trigger the JS fallback.
    stubEngine({
      runOnce: jest.fn().mockResolvedValue({
        outcome: 'failed',
        cycleId: 'cycle-2',
        syncedCount: 0,
        backlogReadCount: 3,
        stage: 'sent',
        errorName: 'ReconcileHttpError',
      }),
    });
    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(BackgroundTaskResult.Success);

    expect(getJsRuntimeMock().createSyncSQLiteRuntime).not.toHaveBeenCalled();
    expect(getJsCycleMock().runHeadlessSyncCycle).not.toHaveBeenCalled();
  });

  it('maps a native abandoned attempt onto a handled success as well', async () => {
    stubEngine({
      runOnce: jest.fn().mockResolvedValue({
        outcome: 'abandoned',
        cycleId: 'cycle-3',
        syncedCount: 0,
        backlogReadCount: 2,
        stage: 'sent',
        errorName: null,
      }),
    });
    const task = loadDefinedTask();

    await expect(task()).resolves.toBe(BackgroundTaskResult.Success);
  });
});
