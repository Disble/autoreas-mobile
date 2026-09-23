import { FOREGROUND_SYNC_TICKER_NATIVE_MODULE_NAME } from './native-foreground-sync-ticker.constants';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from './native-module-loader/native-module-loader.helpers';
import type {
  CreateNativeForegroundSyncTickerParams,
  ForegroundSyncTicker,
  NativeForegroundSyncTickerModule,
} from './native-foreground-sync-ticker.types';

// The lazily-required `expo-modules-core` loader and the guarded null lookup live in
// `native-module-loader/`, shared by the ticker, sync-engine, and sync-journal seams.

/**
 * Creates the JS-side seam over the native foreground-sync ticker module (ODD
 * native-foreground-sync-service T5). `start()`/`stop()` delegate straight to the native module,
 * which persists ticking state, arms/cancels the tick alarm, and starts/stops
 * `SyncForegroundService` (see `TickAlarmScheduler.kt`'s `startSyncTicking`/`stopSyncTicking`) --
 * there is no JS-side idempotency guard here on purpose: native `startTicking()` already stops
 * then restarts unconditionally, so a caller invoking `start()` again (e.g. the app opening while
 * the FGS mode is on) is safe and simply re-arms/restores the service.
 *
 * `isRunning()` delegates straight to the native module on every call instead of tracking local
 * closure state: a fresh `createNativeForegroundSyncTicker()` call (e.g. from a headless
 * background-task wake, a different JS object than whatever live adapter last called `start()`)
 * must still read the real native ticking state, not a flag that always starts `false` in a new
 * instance.
 *
 * Before T5 this seam also subscribed to a native `onTick` event and reported cycle completion
 * back through `notifyCycleComplete()`. Native no longer emits `onTick` or needs that report
 * (T3+T4 moved cycle dispatch and execution entirely into `SyncForegroundService` /
 * `SyncEngineRunner`), so that wiring is retired here.
 *
 * Degrades to a no-op when the native module is unavailable (Expo Go, iOS, or a non-prebuilt
 * binary) instead of crashing -- `isRunning()` then always answers `false`.
 */
export function createNativeForegroundSyncTicker(
  params: CreateNativeForegroundSyncTickerParams = {},
): ForegroundSyncTicker {
  const loadModule =
    params.requireOptionalNativeModule ??
    loadDefaultOptionalNativeModuleLoader<NativeForegroundSyncTickerModule>();
  const nativeModule = loadOptionalNativeModule(
    loadModule,
    FOREGROUND_SYNC_TICKER_NATIVE_MODULE_NAME,
  );

  return {
    start(intervalMs: number) {
      nativeModule?.start(intervalMs);
    },

    stop() {
      nativeModule?.stop();
    },

    isRunning() {
      return nativeModule?.isRunning() ?? false;
    },
  };
}
