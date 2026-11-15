import { PermissionsAndroid, Platform } from 'react-native';
import { createNativeForegroundServicePresence } from '../native-foreground-service-presence.helpers';
import { createNativeForegroundSyncTicker } from '../native-foreground-sync-ticker.helpers';
import {
  FOREGROUND_SYNC_INTERVAL_MS,
  NOTIFICATION_PERMISSION_API_LEVEL,
  SYNC_FOREGROUND_SERVICE_CHANNEL_ID,
} from './native-foreground-sync-adapter.constants';
import type { NativeForegroundSyncAdapter } from './native-foreground-sync-adapter.types';
import type { SyncExecutionStatus } from '../sync-execution-strategy.types';

/** Builds the safe status reported off Android, where this strategy never applies. */
function createUnsupportedStatus(): SyncExecutionStatus {
  return {
    registrationStatus: 'unsupported',
    executionMode: 'best_effort_background_task',
    isForegroundServiceRunning: false,
    canShowPersistentNotification: false,
    isBackgroundTaskRegistered: false,
  };
}

/**
 * Asks for the notification permission the service's ongoing notification needs, and answers
 * whether it is granted. Android 13+ asks for `POST_NOTIFICATIONS`; older versions grant it at
 * install. Never throws: a failed request (no activity to show the dialog) answers `false`.
 */
async function requestNotificationPermission(): Promise<boolean> {
  if (Number(Platform.Version) < NOTIFICATION_PERMISSION_API_LEVEL) {
    return true;
  }

  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/**
 * Creates the execution strategy adapter over the native foreground-sync service (ODD
 * native-foreground-sync-service T5). Kotlin owns the whole attempt now (T3's
 * `SyncForegroundService` + `SyncEngineRunner`): this adapter no longer runs any cycle, ticker
 * subscription, or attempt-gate logic of its own -- `register()`/`unregister()` are thin calls
 * onto the native ticker seam, which itself persists ticking state, arms the tick alarm and
 * starts/stops the native service (see `TickAlarmScheduler.kt`).
 *
 * `register()` also asks for the notification permission, so the native service's own
 * notification can actually be shown (see [requestNotificationPermission]).
 * Requesting permission never gates starting the native service: a background/foreground service
 * start does not require notification permission to succeed, only to be visible, and native
 * already degrades a start refusal to a logged warning rather than a crash (T4's receiver
 * contract). Gating it here would only make Settings worse at reflecting reality, not the service
 * more correct.
 */
export function createNativeForegroundSyncAdapter(): NativeForegroundSyncAdapter {
  const ticker = createNativeForegroundSyncTicker();
  const presence = createNativeForegroundServicePresence();
  let canShowPersistentNotification = false;

  return {
    async register() {
      if (Platform.OS !== 'android') {
        return;
      }

      canShowPersistentNotification = await requestNotificationPermission();

      ticker.start(FOREGROUND_SYNC_INTERVAL_MS);
    },

    async unregister() {
      if (Platform.OS !== 'android') {
        return;
      }

      ticker.stop();
    },

    getStatus() {
      if (Platform.OS !== 'android') {
        return Promise.resolve(createUnsupportedStatus());
      }

      // Live ground truth, not a local closure flag: a foreground-service notification cannot
      // outlive its service, so this is a faithful proxy for "is the service actually up right
      // now" -- the same reasoning `native-foreground-service-presence.helpers.ts` documents.
      const isForegroundServiceRunning = presence.isForegroundServiceRunning(
        SYNC_FOREGROUND_SERVICE_CHANNEL_ID,
      );

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
