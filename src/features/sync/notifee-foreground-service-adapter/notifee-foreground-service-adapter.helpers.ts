import notifee, {
  AndroidForegroundServiceType,
  AuthorizationStatus,
} from 'react-native-notify-kit';
import { Platform } from 'react-native';
import { runHeadlessSyncCycle } from '../headless-sync-cycle.helpers';
import { FOREGROUND_SYNC_INTERVAL_MS, NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID } from './notifee-foreground-service-adapter.constants';
import { createForegroundSyncRunner } from '../foreground-sync-runner.helpers';
import { createNativeForegroundSyncTicker } from '../native-foreground-sync-ticker.helpers';
import { createSyncSQLiteRuntime } from '../sqlite-sync-runtime.helpers';
import { createNativeSyncEngine } from '../native-sync-engine/native-sync-engine.helpers';
import { withExclusiveSyncCycle } from '../sync-cycle-lock.helpers';
import { recordSyncAttemptFailed } from '../sync-runtime-status.helpers';
import type { NotifeeForegroundServiceAdapter } from './notifee-foreground-service-adapter.types';
import type { SyncExecutionStatus } from '../sync-execution-strategy.types';
import type { SyncSQLiteRuntime } from '../sqlite-sync-runtime.types';
import { SchemaNotReadyError } from '../../../infrastructure/db/startup/startup.errors';

/**
 * Builds the status reported when the foreground-service strategy cannot run (non-Android).
 */
function createUnsupportedStatus(): SyncExecutionStatus {
  return {
    registrationStatus: 'unsupported',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    // This strategy only owns the FGS path; the WorkManager floor reports its own flag.
    isBackgroundTaskRegistered: false,
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
    if (!serviceRuntime) {
      return;
    }

    try {
      await serviceRuntime.close();
      serviceRuntime = null;
    } catch {
      // Never throw from teardown: unregister() and the stop-sync background event both call
      // this as their last step, so a rejection here must not replace or mask everything that
      // already succeeded. The handle is kept (Decision 6) rather than nulled on a failed close,
      // so a later attempt can still retry the close and release the lock.
    }
  }

  const foregroundSyncTicker = createNativeForegroundSyncTicker();

  async function recordForegroundCycleError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Foreground sync cycle failed';

    try {
      if (!serviceRuntime) {
        serviceRuntime = createSyncSQLiteRuntime({ owner: 'foreground_service' });
      }

      const rawDb = await serviceRuntime.open();

      await recordSyncAttemptFailed(rawDb, 'foreground_service', Date.now(), message);
    } catch {
      // Best-effort observability: if the runtime status snapshot itself cannot be reached here,
      // there is no further fallback -- this is error-handling code and must never crash the FGS.
    }
  }

  const foregroundSyncRunner = createForegroundSyncRunner({
    ticker: foregroundSyncTicker,
    onCycleError: recordForegroundCycleError,
    runCycle: async () => {
      // The native engine is tried first because it removes the JS timer (runtime open, lock,
      // JS cycle) from the attempt entirely: the engine owns its own connection and takes the
      // cycle lease itself, so when it answers with any outcome other than `unavailable` this
      // tick returns without touching the JS path. The JS cycle below stays fully intact as the
      // fallback for a missing native module (or an `unavailable` outcome from an engine that
      // reported available), mirroring the engine-first routing in `runBackgroundSyncCycle`.
      const engine = createNativeSyncEngine();

      if (engine.isAvailable()) {
        const engineResult = await engine.runOnce('foreground_service');

        if (engineResult.outcome !== 'unavailable') {
          return;
        }
      }

      if (!serviceRuntime) {
        serviceRuntime = createSyncSQLiteRuntime({ owner: 'foreground_service' });
      }

      try {
        const rawDb = await serviceRuntime.open();

        await withExclusiveSyncCycle({
          rawDb,
          owner: 'foreground_service',
          run: async () => {
            await runHeadlessSyncCycle({
              runtime: serviceRuntime!,
              triggerSource: 'foreground_service',
            });
          },
        });
      } catch (error) {
        await closeServiceRuntime();

        if (error instanceof SchemaNotReadyError) {
          return;
        }

        throw error;
      }
    },
  });

  /**
   * Starts the foreground sync ticker and runner exactly once. Both start sites (the JS flow
   * that starts the service in register(), and the Notifee cold-start callback) share this
   * single definition of what starting means; the isRunning guards make a second call a no-op.
   * Returns the runner start promise when this call started the runner, or null when the
   * runner was already running.
   */
  function startForegroundSyncWork(): Promise<void> | null {
    if (!foregroundSyncTicker.isRunning()) {
      foregroundSyncTicker.start(FOREGROUND_SYNC_INTERVAL_MS);
    }

    if (foregroundSyncRunner.isRunning()) {
      return null;
    }

    return foregroundSyncRunner.start();
  }

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
            foregroundSyncTicker.stop();
            await notifee.stopForegroundService();
            isForegroundServiceRunning = false;
            await closeServiceRuntime();
          }
        });
        hasRegisteredBackgroundEvents = true;
      }

      notifee.registerForegroundService(() => {
        isForegroundServiceRunning = true;

        // Cold start: when Notifee boots the service without a live JS caller, this callback is
        // the only start site and its runner start promise keeps the service alive. When the
        // runner was already started below by register(), return a never-resolving promise so
        // Notifee keeps the service alive instead of starting the runner a second time.
        return startForegroundSyncWork() ?? new Promise<void>(() => {});
      });

      await notifee.createChannel({
        id: NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID,
        name: 'Sync continuo',
      });

      // Evidence (tablet, 2026-09-20 build): with the foreground service UP (isForeground=true,
      // notification posted, ForegroundServiceTypeLoggerModule line present) there was no
      // `ForegroundSyncTicker:ticking` wake lock in `dumpsys power`, and the ticker's native
      // module was available to JS (the once-per-runtime degradation warning in
      // native-module-loader never fired). The remaining explanation is ordering: code placed
      // after `await notifee.displayNotification({ asForegroundService: true })` never runs,
      // because that await can be the last thing that resolves before the process is handed to
      // Notifee's headless context. The service is started by that call, but nothing about
      // starting the tick live needs to wait for it to resolve, so the sync work starts BEFORE
      // the notification is displayed, and the flag is set at the point the service is being
      // started. The cold-start callback above stays for the case where Notifee boots the
      // service without a live JS caller.
      isForegroundServiceRunning = true;
      startForegroundSyncWork()?.catch(() => {
        // The runner already surfaced the failure through onCycleError (and closed the runtime);
        // this fire-and-forget start must not become an unhandled rejection inside register().
      });
      // Temporary diagnostic: confirms on device that the sync work started before the
      // notification await. Remove once the ticker is observed ticking on a device (ODD task
      // T10 in odd/tasks/mobile-sync-native-engine.md).
      console.warn('[fgs] foreground sync work started');

      await notifee.displayNotification({
        title: 'Sync continuo activo',
        body: 'Autoreas mantiene la sincronización activa en segundo plano.',
        android: {
          channelId: NOTIFEE_FOREGROUND_SYNC_CHANNEL_ID,
          asForegroundService: true,
          ongoing: true,
          // The manifest (plugins/withAndroidForegroundSync.js) is what declares the foreground
          // service type; the runtime type passed to startForeground must be a subset of the
          // declared manifest attribute or Android throws IllegalArgumentException and the app
          // crashes. Naming the type here (data_sync) is what caused that crash, so the manifest
          // stays the single source of truth and we request the MANIFEST sentinel, which the
          // native layer resolves from the declared service type.
          foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MANIFEST],
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
    },

    async unregister() {
      if (Platform.OS !== 'android') {
        return;
      }

      await foregroundSyncRunner.stop();
      foregroundSyncTicker.stop();
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
        isBackgroundTaskRegistered: false,
      });
    },
  };
}
