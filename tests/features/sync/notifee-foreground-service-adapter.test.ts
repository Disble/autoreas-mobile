import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { Platform } from 'react-native';
import { createNotifeeForegroundServiceAdapter } from '../../../src/features/sync/notifee-foreground-service-adapter';

describe('notifee-foreground-service-adapter', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');

  beforeEach(() => {
    jest.clearAllMocks();
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

    expect(notifee.createChannel).toHaveBeenCalledWith({
      id: 'autoreas-sync-foreground',
      name: 'Sync continuo',
    });
    expect(notifee.displayNotification).toHaveBeenCalled();
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

    expect(notifee.stopForegroundService).toHaveBeenCalledTimes(1);
    await expect(adapter.getStatus()).resolves.toEqual({
      registrationStatus: 'unregistered',
      executionMode: 'android_foreground_service',
      isForegroundServiceRunning: false,
      canShowPersistentNotification: true,
    });
  });
});
