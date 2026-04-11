import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { Platform } from 'react-native';
import { createNotifeeForegroundServiceAdapter } from '../../../src/features/sync/notifee-foreground-service-adapter';
import * as dbClient from '../../../src/infrastructure/db/client';
import * as headlessSyncCycleModule from '../../../src/features/sync/headless-sync-cycle.helpers';

const mockStart = jest.fn<Promise<void>, []>();
const mockStop = jest.fn<Promise<void>, []>();
const mockIsRunning = jest.fn<boolean, []>();

jest.mock('../../../src/features/sync/foreground-sync-runner.helpers', () => ({
  createForegroundSyncRunner: jest.fn(() => ({
    start: mockStart,
    stop: mockStop,
    isRunning: mockIsRunning,
  })),
}));

jest.mock('../../../src/infrastructure/db/client', () => ({
  openAppDatabaseSync: jest.fn(),
}));

jest.mock('../../../src/features/sync/headless-sync-cycle.helpers', () => ({
  runHeadlessSyncCycle: jest.fn(),
}));

describe('notifee-foreground-service-adapter', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');

  beforeEach(() => {
    jest.clearAllMocks();
    (dbClient.openAppDatabaseSync as jest.Mock).mockReturnValue({ id: 'raw-db' });
    (headlessSyncCycleModule.runHeadlessSyncCycle as jest.Mock).mockResolvedValue({
      kind: 'success',
      syncedCount: 1,
    });
    mockStart.mockResolvedValue(undefined);
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
    expect(dbClient.openAppDatabaseSync).not.toHaveBeenCalled();
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'registered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: true,
      canShowPersistentNotification: true,
    });
  });

  it('stops foreground notification and reports unregistered state', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValue({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();
    await adapter.unregister();

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: true,
    });
  });

  it('runs foreground sync cycles with the foreground service trigger source', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });
    mockStart.mockImplementation(async () => {
      const rawDb = dbClient.openAppDatabaseSync();

      await headlessSyncCycleModule.runHeadlessSyncCycle({
        rawDb,
        triggerSource: 'foreground_service',
      });
    });

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const foregroundServiceTask = (notifee.registerForegroundService as jest.Mock).mock.calls[0]?.[0];

    await foregroundServiceTask();

    expect(dbClient.openAppDatabaseSync).toHaveBeenCalledTimes(1);
    expect(headlessSyncCycleModule.runHeadlessSyncCycle).toHaveBeenCalledWith({
      rawDb: { id: 'raw-db' },
      triggerSource: 'foreground_service',
    });
  });

  it('stops the runner when the notification stop action is pressed', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    (notifee.requestPermission as jest.Mock).mockResolvedValueOnce({
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
    });

    const adapter = createNotifeeForegroundServiceAdapter();

    await adapter.register();

    const backgroundEventHandler = (notifee.onBackgroundEvent as jest.Mock).mock.calls[0]?.[0];

    await backgroundEventHandler({
      detail: {
        pressAction: { id: 'stop-sync' },
      },
    });

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: true,
    });
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
    });
  });
});
