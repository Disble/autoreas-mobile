import notifee, {
  AndroidForegroundServiceType,
  AuthorizationStatus,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID } from './notifee-foreground-service-adapter.constants';
import type { NotifeeForegroundServiceAdapter } from './notifee-foreground-service-adapter.types';
import type { SyncExecutionStatus } from './sync-execution-strategy.types';

function createUnsupportedStatus(): SyncExecutionStatus {
  return {
    registrationStatus: 'unsupported',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
  };
}

/**
 * Creates the infrastructure adapter that translates Notifee APIs into the sync execution contract.
 * It encapsulates notification permission, channel creation, service start, and teardown as pure functions plus closure state.
 */
export function createNotifeeForegroundServiceAdapter(): NotifeeForegroundServiceAdapter {
  let canShowPersistentNotification = false;
  let isForegroundServiceRunning = false;

  async function getAndroidPermissionState() {
    const result = await notifee.requestPermission();

    canShowPersistentNotification = result.authorizationStatus >= AuthorizationStatus.AUTHORIZED;

    return canShowPersistentNotification;
  }

  return {
    mode: 'android_foreground_service',
    async register() {
      if (Platform.OS !== 'android') {
        return;
      }

      const isAuthorized = await getAndroidPermissionState();

      if (!isAuthorized) {
        isForegroundServiceRunning = false;
        return;
      }

      await notifee.createChannel({
        id: NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID,
        name: 'Sync continuo',
      });

      await notifee.displayNotification({
        title: 'Sync continuo activo',
        body: 'Autoreas mantiene la sincronización activa en segundo plano.',
        android: {
          channelId: NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID,
          asForegroundService: true,
          ongoing: true,
          foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_DATA_SYNC],
          pressAction: {
            id: 'open-settings',
          },
          actions: [
            {
              title: 'Detener',
              pressAction: { id: 'stop-sync' },
            },
          ],
        },
      });

      isForegroundServiceRunning = true;
    },

    async unregister() {
      if (Platform.OS !== 'android') {
        return;
      }

      await notifee.stopForegroundService();
      isForegroundServiceRunning = false;
    },

    async getStatus() {
      if (Platform.OS !== 'android') {
        return createUnsupportedStatus();
      }

      return {
        registrationStatus: isForegroundServiceRunning ? 'registered' : 'unregistered',
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning,
        canShowPersistentNotification,
      };
    },
  };
}
