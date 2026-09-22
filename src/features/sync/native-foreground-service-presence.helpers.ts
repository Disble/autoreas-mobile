import { FOREGROUND_SERVICE_PRESENCE_NATIVE_MODULE_NAME } from './native-foreground-service-presence.constants';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from './native-module-loader/native-module-loader.helpers';
import type {
  CreateNativeForegroundServicePresenceParams,
  NativeForegroundServicePresence,
  NativeForegroundServicePresenceModule,
} from './native-foreground-service-presence.types';

// The lazily-required `expo-modules-core` loader and the guarded null lookup live in
// `native-module-loader/`, shared by the ticker, sync-engine, sync-journal, and every other seam
// on this native module.

/**
 * Creates the JS-side seam over the native foreground-service presence check. The surface lives
 * on the same `ForegroundSyncTicker` local Expo module as the tick source and the
 * battery-optimization exemption (see that module's class doc for why); this seam is independent
 * of the other two because its lifecycle is unrelated -- it is a point-in-time status read with
 * no `start`/`stop` pairing and no request/response like the exemption flow.
 *
 * This is the one signal a headless caller can trust for "is the foreground service actually
 * running right now": the adapter's own in-memory `isForegroundServiceRunning` and the ticker
 * seam's `isRunning()` are plain JS closure state that always starts at `false` in a fresh
 * process, and the persisted `sync_runtime_status` snapshot is written only by the live
 * foreground runtime, so it goes stale exactly when the service dies silently in the background.
 * The native check queries `NotificationManager.getActiveNotifications()` for the given channel
 * id -- a foreground-service notification cannot outlive its service, so this is a faithful
 * proxy for the real native state, not a guess.
 *
 * When the native module is unavailable (Expo Go, iOS, or a non-prebuilt binary) this degrades
 * to `isForegroundServiceRunning() === false` instead of crashing, matching the degrade-honestly
 * contract every native-sync seam follows.
 */
export function createNativeForegroundServicePresence(
  params: CreateNativeForegroundServicePresenceParams = {},
): NativeForegroundServicePresence {
  const loadModule =
    params.requireOptionalNativeModule ??
    loadDefaultOptionalNativeModuleLoader<NativeForegroundServicePresenceModule>();
  const nativeModule = loadOptionalNativeModule(
    loadModule,
    FOREGROUND_SERVICE_PRESENCE_NATIVE_MODULE_NAME,
  );

  return {
    isForegroundServiceRunning(channelId: string) {
      return nativeModule?.isForegroundServiceRunning(channelId) ?? false;
    },
  };
}
