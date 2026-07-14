import notifee, {
  AndroidForegroundServiceType,
  AuthorizationStatus,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { runHeadlessSyncCycle } from '../headless-sync-cycle.helpers';
import { FOREGROUND_SYNC_INTERVAL_MS, NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID } from './notifee-foreground-service-adapter.constants';
import { createForegroundSyncRunner } from '../foreground-sync-runner.helpers';
import { createSyncSQLiteRuntime } from '../sqlite-sync-runtime.helpers';
import type { NotifeeForegroundServiceAdapter } from './notifee-foreground-service-adapter.types';
import type { SyncExecutionStatus } from '../sync-execution-strategy.types';
import type { SyncSQLiteRuntime } from '../sqlite-sync-runtime.types';

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
  let serviceRuntime: SyncSQLiteRuntime | null = null;

  async function closeServiceRuntime() {
    if (serviceRuntime) {
      await serviceRuntime.close();
      serviceRuntime = null;
    }
  }

  const foregroundSyncRunner = createForegroundSyncRunner({
    intervalMs: FOREGROUND_SYNC_INTERVAL_MS,
    runCycle: async () => {
      if (!serviceRuntime) {
        serviceRuntime = createSyncSQLiteRuntime({ owner: 'foreground_service' });
      }

      try {
        await runHeadlessSyncCycle({
          runtime: serviceRuntime,
          triggerSource: 'foreground_service',
        });
      } catch (error) {
        await closeServiceRuntime();
        throw error;
      }
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
            await closeServiceRuntime();
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
      await closeServiceRuntime();
    },

    getStatus() {
      if (Platform.OS !== 'android') {
        return Promise.resolve(createUnsupportedStatus());
      }

      return Promise.resolve({
        registrationStatus: isForegroundServiceRunning ? 'registered' : 'unregistered',
        executionMode: 'android_foreground_service',
        isForegroundServiceRunning,
        canShowPersistentNotification,
      });
    },
  };
}
