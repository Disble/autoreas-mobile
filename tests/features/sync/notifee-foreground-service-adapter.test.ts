import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { createNotifeeForegroundServiceAdapter } from '../../../src/features/sync/notifee-foreground-service-adapter';
import * as headlessSyncCycleModule from '../../../src/features/sync/headless-sync-cycle.helpers';
import * as sqliteSyncRuntimeModule from '../../../src/features/sync/sqlite-sync-runtime.helpers';
import type { SyncSQLiteRuntime } from '../../../src/features/sync/sqlite-sync-runtime.types';

const mockStart = jest.fn<Promise<void>, []>();
const mockStop = jest.fn<Promise<void>, []>();
const mockIsRunning = jest.fn<boolean, []>();
const mockRuntimeClose = jest.fn<Promise<void>, []>();

let capturedRunCycle: (() => Promise<void>) | null = null;

jest.mock('../../../src/features/sync/foreground-sync-runner.helpers', () => ({
  createForegroundSyncRunner: jest.fn((params: { runCycle: () => Promise<void> }) => {
    capturedRunCycle = params.runCycle;

    return {
      start: mockStart,
      stop: mockStop,
      isRunning: mockIsRunning,
    };
  }),
}));

jest.mock('../../../src/features/sync/headless-sync-cycle.helpers', () => ({
  runHeadlessSyncCycle: jest.fn(),
}));

jest.mock('../../../src/features/sync/sqlite-sync-runtime.helpers', () => ({
  createSyncSQLiteRuntime: jest.fn(),
}));

describe('notifee-foreground-service-adapter', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  const rawDb = { id: 'raw-db' } as unknown as SQLiteDatabase;

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
    mockRuntimeClose.mockResolvedValue(undefined);

    (sqliteSyncRuntimeModule.createSyncSQLiteRuntime as jest.Mock).mockReturnValue(buildRuntime());
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'success',
      syncedCount: 1,
    });
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

  it('starts foreground notification and reports registered state on Android', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    expect(notifee.registerForegroundService).toHaveBeenCalledTimes(1);
    expect(notifee.onBackgroundEvent).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
    expect(notifee.createChannel).toHaveBeenCalledWith({
      id: 'autoreas-sync-foreground',
      name: 'Sync continuo',
    });
    expect(notifee.displayNotification).toHaveBeenCalled();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    expect(mockStart).toHaveBeenCalledTimes(1);
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

  it('stops foreground notification, closes the runtime, and reports unregistered state', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValue({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();
    await adapter.unregister();

    expect(mockStop).toHaveBeenCalledTimes(1);
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
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });
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

  it('stops the runner and closes the runtime when the notification stop action is pressed', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });

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
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockRejectedValue(
      new Error('terminal'),
    );

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask().catch(() => {
      // The implementation rethrows the cycle error after closing the runtime.
    });

    expect(mockRuntimeClose).toHaveBeenCalledTimes(1);
  });

  it('does not mark the service as running when notification permission is denied', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.DENIED,
    });

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
