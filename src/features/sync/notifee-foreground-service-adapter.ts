import notifee, {
  AndroidForegroundServiceType,
  AuthorizationStatus,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { openAppDatabaseSync } from '../../infrastructure/db/client';
import { runHeadlessSyncCycle } from './headless-sync-cycle.helpers';
import { NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID } from './notifee-foreground-service-adapter.constants';
import { createForegroundSyncRunner } from './foreground-sync-runner.helpers';
import type { NotifeeForegroundServiceAdapter } from './notifee-foreground-service-adapter.types';
import type { SyncExecutionStatus } from './sync-execution-strategy.types';

const FOREGROUND_SYNC_INTERVAL_MS = 15_000;

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
  let hasRegisteredBackgroundEvents = false;
  const foregroundSyncRunner = createForegroundSyncRunner({
    intervalMs: FOREGROUND_SYNC_INTERVAL_MS,
    runCycle: async () => {
      const rawDb = openAppDatabaseSync();

      await runHeadlessSyncCycle({
        rawDb,
        triggerSource: 'foreground_service',
      });
    },
  });

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

      if (!hasRegisteredBackgroundEvents) {
        notifee.onBackgroundEvent(async (event) => {
          if (event.detail.pressAction?.id === 'stop-sync') {
            await foregroundSyncRunner.stop();
            await notifee.stopForegroundService();
            isForegroundServiceRunning = false;
          }
        });
        hasRegisteredBackgroundEvents = true;
      }

      notifee.registerForegroundService(() => {
        isForegroundServiceRunning = true;

        return foregroundSyncRunner.start();
      });

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

      await foregroundSyncRunner.stop();
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
