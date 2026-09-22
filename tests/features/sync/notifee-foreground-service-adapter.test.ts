import notifee, {
  AndroidForegroundServiceType,
  AuthorizationStatus,
} from 'react-native-notify-kit';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createNotifeeForegroundServiceAdapter } from '../../../src/features/sync/notifee-foreground-service-adapter';
import { FOREGROUND_SYNC_INTERVAL_MS } from '../../../src/features/sync/notifee-foreground-service-adapter/notifee-foreground-service-adapter.constants';
import * as headlessSyncCycleModule from '../../../src/features/sync/headless-sync-cycle.helpers';
import * as sqliteSyncRuntimeModule from '../../../src/features/sync/sqlite-sync-runtime.helpers';
import * as syncCycleLockModule from '../../../src/features/sync/sync-cycle-lock.helpers';
import * as syncRuntimeStatusModule from '../../../src/features/sync/sync-runtime-status.helpers';
import type { NativeSyncEngine } from '../../../src/features/sync/native-sync-engine/native-sync-engine.types';
import type { SyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.types';
import { SchemaNotReadyError } from '../../../src/infrastructure/db/startup';

/** Mock for the foreground sync runner's start(), so tests decide what a started runner does. */
const mockStart = jest.fn<Promise<void>, []>();
/** Mock for the foreground sync runner's stop(). */
const mockStop = jest.fn<Promise<void>, []>();
/** Mock for the foreground sync runner's isRunning(). */
const mockIsRunning = jest.fn<boolean, []>();
/** Mock for the sync SQLite runtime's close(). */
const mockRuntimeClose = jest.fn<Promise<void>, []>();
/** Mock for the native ticker's start(); receives the tick interval in milliseconds. */
const mockTickerStart = jest.fn<void, [number]>();
/** Mock for the native ticker's stop(). */
const mockTickerStop = jest.fn<void, []>();
/** Mock for the native ticker's onTick(); returns the registered tick callback when called. */
const mockTickerOnTick = jest.fn<() => void, [() => void]>();
/** Mock for the native ticker's isRunning(). */
const mockTickerIsRunning = jest.fn<boolean, []>();

/** The jest.setup.ts mock of react-native-notify-kit predates the manifest sentinel in this
 * repo's usage; mirror the real runtime value (FOREGROUND_SERVICE_TYPE_MANIFEST = -1 in
 * react-native-notify-kit's AndroidForegroundServiceType) onto the shared mock object so the
 * adapter under test and these assertions use the same production constant.
 */
const mockedServiceTypes = AndroidForegroundServiceType as unknown as Record<string, number>;
mockedServiceTypes.FOREGROUND_SERVICE_TYPE_MANIFEST = -1;

/** Captured runCycle from the mocked createForegroundSyncRunner, invoked directly by tests. */
let capturedRunCycle: (() => Promise<void>) | null = null;
/** Captured onCycleError from the mocked createForegroundSyncRunner, invoked directly by tests. */
let capturedOnCycleError: ((error: unknown) => void | Promise<void>) | null = null;

jest.mock('../../../src/features/sync/foreground-sync-runner.helpers', () => ({
  createForegroundSyncRunner: jest.fn(
    (params: {
      runCycle: () => Promise<void>;
      onCycleError: (error: unknown) => void | Promise<void>;
    }) => {
      capturedRunCycle = params.runCycle;
      capturedOnCycleError = params.onCycleError;

      return {
        start: mockStart,
        stop: mockStop,
        isRunning: mockIsRunning,
      };
    },
  ),
}));

jest.mock('../../../src/features/sync/native-foreground-sync-ticker.helpers', () => ({
  createNativeForegroundSyncTicker: jest.fn(() => ({
    start: mockTickerStart,
    stop: mockTickerStop,
    onTick: mockTickerOnTick,
    isRunning: mockTickerIsRunning,
  })),
}));

jest.mock('../../../src/features/sync/headless-sync-cycle.helpers', () => ({
  runHeadlessSyncCycle: jest.fn(),
}));

jest.mock('../../../src/features/sync/sqlite-sync-runtime.helpers', () => ({
  createSyncSQLiteRuntime: jest.fn(),
}));

jest.mock('../../../src/features/sync/sync-cycle-lock.helpers', () => ({
  withExclusiveSyncCycle: jest.fn(
    async (params: { run: () => Promise<void> }) => params.run(),
  ),
}));

jest.mock('../../../src/features/sync/sync-runtime-status.helpers', () => ({
  recordSyncAttemptFailed: jest.fn(),
}));

/** Module path of the native sync engine helpers, shared by jest.mock and the stub loader. */
const NATIVE_ENGINE_HELPERS = '../../../src/features/sync/native-sync-engine/native-sync-engine.helpers';

jest.mock(NATIVE_ENGINE_HELPERS, () => ({ createNativeSyncEngine: jest.fn() }));

/** The closed-vocabulary result a successful engine run reports; unavailable overrides it. */
const ENGINE_CLOSED_RESULT = { outcome: 'closed', cycleId: 'cycle-1', syncedCount: 2, backlogReadCount: 0, stage: 'closed', errorName: null };

/** Points the mocked createNativeSyncEngine at a stub engine; returns the stub for assertions. */
function stubEngine(engine: Partial<NativeSyncEngine> = {}): NativeSyncEngine {
  const stub = {
    runOnce: jest.fn().mockResolvedValue(ENGINE_CLOSED_RESULT),
    isAvailable: () => true,
    ...engine,
  } as NativeSyncEngine;
  (jest.requireMock(NATIVE_ENGINE_HELPERS) as { createNativeSyncEngine: jest.Mock })
    .createNativeSyncEngine.mockReturnValue(stub);
  return stub;
}

describe('notifee-foreground-service-adapter', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  const rawDb = { id: 'raw-db' } as unknown as SQLiteDatabase;

  /** Puts the adapter on Android with notification permission resolved to the given status. */
  function authorizeAndroid(authorizationStatus = AuthorizationStatus.AUTHORIZED) {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus });
  }

  function buildRuntime(owner: 'foreground_service' = 'foreground_service'): SyncSQLiteRuntime {
    return {
      owner,
      rawDb,
      isOpen: () => true,
      open: jest.fn().mockResolvedValue(rawDb),
      withDatabase: jest.fn(),
      close: mockRuntimeClose,
    } as unknown as SyncSQLiteRuntime;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    capturedRunCycle = null;
    capturedOnCycleError = null;
    // Default the native engine to unavailable so pre-existing cases exercise the JS cycle path.
    stubEngine({ isAvailable: () => false, runOnce: jest.fn() });
    mockRuntimeClose.mockResolvedValue(undefined);
    mockTickerOnTick.mockReturnValue(jest.fn());
    mockTickerIsRunning.mockReturnValue(false);

    (sqliteSyncRuntimeModule.createSyncSQLiteRuntime as jest.Mock).mockReturnValue(buildRuntime());
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'success',
      syncedCount: 1,
    });
    (syncCycleLockModule.withExclusiveSyncCycle as jest.Mock).mockImplementation(
      async (params: { run: () => Promise<void> }) => params.run(),
    );
    mockStart.mockImplementation(async () => {
      if (capturedRunCycle) {
        await capturedRunCycle();
      }
    });
    mockStop.mockResolvedValue(undefined);
    mockIsRunning.mockReturnValue(false);
  });

  afterEach(() => {
    if (platformDescriptor) {
      Object.defineProperty(Platform, 'OS', platformDescriptor);
    }
  });

  it('returns unsupported status outside Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });

    const adapter = createNotifeeForegroundServiceAdapter();

    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unsupported',
      executionMode: 'best_effort_background_task',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isBackgroundTaskRegistered: false,
    });
  });

  it('requests the manifest-declared foreground service type and never data_sync', async () => {
    authorizeAndroid();

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const notificationInput = (notifee.displayNotification as jest.Mock).mock.calls[0]?.[0];

    expect(notificationInput.android.foregroundServiceTypes).toEqual([
      AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MANIFEST,
    ]);
    expect(notificationInput.android.foregroundServiceTypes).not.toContain(
      AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
    );
  });

  it('starts foreground notification and reports registered state on Android', async () => {
    authorizeAndroid();

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    expect(notifee.registerForegroundService).toHaveBeenCalledTimes(1);
    expect(notifee.onBackgroundEvent).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockTickerStart).toHaveBeenCalledWith(FOREGROUND_SYNC_INTERVAL_MS);
    expect(notifee.createChannel).toHaveBeenCalledWith({
      id: 'autoreas-sync-foreground',
      name: 'Sync continuo',
    });
    expect(notifee.displayNotification).toHaveBeenCalled();

    // Simulate the real post-start state: a warm cold-start callback must not re-start anything.
    mockIsRunning.mockReturnValue(true);
    mockTickerIsRunning.mockReturnValue(true);

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    void foregroundServiceTask();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockTickerStart).toHaveBeenCalledTimes(1);
    expect(sqliteSyncRuntimeModule.createSyncSQLiteRuntime).toHaveBeenCalledWith({
      owner: 'foreground_service',
    });
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: true,
      canShowPersistentNotification: true,
      isBackgroundTaskRegistered: false,
    });
  });

  it('starts the foreground sync work before displaying the notification', async () => {
    authorizeAndroid();

    // Ordering is observable here: record the invocation order of the runner start and the
    // notification display. Device evidence (2026-09-20) showed that code placed after the
    // `displayNotification({ asForegroundService: true })` await never runs, so the start
    // must be invoked before that call is made.
    const callOrder: string[] = [];
    (notifee.displayNotification as jest.Mock).mockImplementationOnce(async () => {
      callOrder.push('displayNotification');
    });
    mockStart.mockImplementationOnce(async () => {
      callOrder.push('startForegroundSyncWork');
    });

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    expect(callOrder).toEqual(['startForegroundSyncWork', 'displayNotification']);
  });

  it('stops foreground notification, closes the runtime, and reports unregistered state', async () => {
    authorizeAndroid();

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();
    await adapter.unregister();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockTickerStop).toHaveBeenCalledTimes(1);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: true,
      isBackgroundTaskRegistered: false,
    });
  });

  it('runs foreground sync cycles with the foreground service trigger source', async () => {
    authorizeAndroid();
    mockStart.mockImplementation(async () => {
      await headlessSyncCycleModule.runHeadlessSyncCycle({
        runtime: buildRuntime(),
        triggerSource: 'foreground_service',
      });
    });

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    expect(headlessSyncCycleModule.runHeadlessSyncCycle).toHaveBeenCalledWith({
      runtime: expect.objectContaining({ owner: 'foreground_service' }),
      triggerSource: 'foreground_service',
    });
  });

  it('wraps the reconcile cycle in the exclusive sync-cycle lock keyed by the foreground_service owner', async () => {
    authorizeAndroid();

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    expect(syncCycleLockModule.withExclusiveSyncCycle).toHaveBeenCalledWith(
      expect.objectContaining({ rawDb, owner: 'foreground_service' }),
    );
  });

  it('treats absent foreground schema readiness as a foreground-service no-op', async () => {
    const runtime = buildRuntime();
    (runtime.open as jest.Mock).mockRejectedValue(new SchemaNotReadyError('missing'));
    (sqliteSyncRuntimeModule.createSyncSQLiteRuntime as jest.Mock).mockReturnValue(runtime);

    createNotifeeForegroundServiceAdapter();

    await expect(capturedRunCycle?.()).resolves.toBeUndefined();
    expect(syncCycleLockModule.withExclusiveSyncCycle).not.toHaveBeenCalled();
    expect(headlessSyncCycleModule.runHeadlessSyncCycle).not.toHaveBeenCalled();
    expect(syncRuntimeStatusModule.recordSyncAttemptFailed).not.toHaveBeenCalled();
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('records a cycle error to the runtime status snapshot via onCycleError', async () => {
    authorizeAndroid();

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    expect(capturedOnCycleError).not.toBeNull();

    await capturedOnCycleError?.(new Error('cycle exploded'));

    expect(syncRuntimeStatusModule.recordSyncAttemptFailed).toHaveBeenCalledWith(
      rawDb,
      'foreground_service',
      expect.any(Number),
      'cycle exploded',
    );
  });

  it('stops the runner and closes the runtime when the notification stop action is pressed', async () => {
    authorizeAndroid();

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    const backgroundEventHandler = (notifee.onBackgroundEvent as jest.Mock).mock.calls[0]?.[0];

    await backgroundEventHandler({
      detail: {
        pressAction: { id: 'stop-sync' },
      },
    });

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockTickerStop).toHaveBeenCalledTimes(1);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: true,
      isBackgroundTaskRegistered: false,
    });
  });

  it('closes the runtime on a terminal cycle error', async () => {
    authorizeAndroid();
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockRejectedValue(
      new Error('terminal'),
    );

    // register() itself now starts the runner, so the terminal failure surfaces during
    // register(); the runner's start promise rejects after closing the runtime. The rejection
    // lands on a later microtask than register() resolving, so flush the queue before asserting.
    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('completes unregister even when the runtime close rejects, keeping the handle for a later retry', async () => {
    authorizeAndroid();
    mockRuntimeClose.mockRejectedValue(new Error('database is locked'));

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    // closeServiceRuntime must never throw: unregister() is its last statement, and a rejected
    // close must not replace or mask everything that already succeeded (stop, ticker stop,
    // stopForegroundService).
    await expect(adapter.unregister()).resolves.toBeUndefined();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockTickerStop).toHaveBeenCalledTimes(1);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('completes the stop-sync background event even when the runtime close rejects', async () => {
    authorizeAndroid();
    mockRuntimeClose.mockRejectedValue(new Error('database is locked'));

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    const backgroundEventHandler = (notifee.onBackgroundEvent as jest.Mock).mock.calls[0]?.[0];

    await expect(
      backgroundEventHandler({ detail: { pressAction: { id: 'stop-sync' } } }),
    ).resolves.toBeUndefined();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockTickerStop).toHaveBeenCalledTimes(1);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('does not start the ticker or runner twice when register() runs a second time', async () => {
    authorizeAndroid();

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockTickerStart).toHaveBeenCalledWith(FOREGROUND_SYNC_INTERVAL_MS);

    // Simulate that the first start took effect in the runner and the ticker.
    mockIsRunning.mockReturnValue(true);
    mockTickerIsRunning.mockReturnValue(true);
    await adapter.register();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockTickerStart).toHaveBeenCalledTimes(1);
  });

  it('does not mark the service as running when notification permission is denied', async () => {
    authorizeAndroid(AuthorizationStatus.DENIED);

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    expect(notifee.registerForegroundService).not.toHaveBeenCalled();
    expect(notifee.displayNotification).not.toHaveBeenCalled();
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: false,
      isBackgroundTaskRegistered: false,
    });
  });
});
