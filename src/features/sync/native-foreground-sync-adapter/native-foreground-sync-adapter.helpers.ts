import notifee, { AuthorizationStatus } from 'react-native-notify-kit';
import { Platform } from 'react-native';
import { createNativeBatteryOptimizationExemption } from '../native-battery-optimization.helpers';
import { createNativeForegroundServicePresence } from '../native-foreground-service-presence.helpers';
import { createNativeForegroundSyncTicker } from '../native-foreground-sync-ticker.helpers';
import {
  FOREGROUND_SYNC_INTERVAL_MS,
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
    // Read live even off Android: an OS-level fact with no register/unregister lifecycle of its
    // own, matching every other status read in this adapter.
    isBatteryOptimizationExempt: createNativeBatteryOptimizationExemption().isExempt(),
  };
}

/**
 * Creates the execution strategy adapter over the native foreground-sync service (ODD
 * native-foreground-sync-service T5). Kotlin owns the whole attempt now (T3's
 * `SyncForegroundService` + `SyncEngineRunner`): this adapter no longer runs any cycle, ticker
 * subscription, or attempt-gate logic of its own -- `register()`/`unregister()` are thin calls
 * onto the native ticker seam, which itself persists ticking state, arms the tick alarm and
 * starts/stops the native service (see `TickAlarmScheduler.kt`).
 *
 * Notifee stays a dependency for exactly one thing here: requesting the OS notification
 * permission so the native service's own notification can actually be shown (Android 13+ requires
 * `POST_NOTIFICATIONS` to post any notification). Notifee no longer owns the foreground service
 * itself -- no channel, no `displayNotification`, no `registerForegroundService`, no stop-sync
 * background event -- all retired with the JS runner/ticker wiring this adapter used to own.
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
    mode: 'android_foreground_service',

    async register() {
      if (Platform.OS !== 'android') {
        return;
      }

      const result = await notifee.requestPermission();
      canShowPersistentNotification = result.authorizationStatus >= AuthorizationStatus.AUTHORIZED;

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
        // Read fresh every call, never cached: the user can grant or revoke this through the
        // system dialog at any time, independent of the FGS registration lifecycle above.
        isBatteryOptimizationExempt: createNativeBatteryOptimizationExemption().isExempt(),
      });
    },
  };
}
