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
 * Creates the JS-side seam over the native foreground-sync ticker module.
 * When the native module is unavailable (Expo Go, iOS, or a non-prebuilt binary) this degrades
 * to a no-op ticker instead of crashing -- the FGS simply runs without a native tick source until
 * a native build is installed; callers can observe this via `isRunning()` staying false.
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
  const listeners = new Set<() => void>();
  let subscription: { remove: () => void } | null = null;
  let isRunning = false;

  function notifyListeners() {
    listeners.forEach((listener) => listener());
  }

  return {
    start(intervalMs: number) {
      if (!nativeModule || isRunning) {
        return;
      }

      // Responding to a tick must make no native call: the wake lock is acquired by the native
      // module for the whole ticking lifetime. Releasing it here once the cycle resolved left the
      // remainder of the interval unprotected, the CPU suspended, and the next tick never fired.
      subscription = nativeModule.addListener('onTick', () => {
        notifyListeners();
      });

      nativeModule.start(intervalMs);
      isRunning = true;
    },

    stop() {
      if (!nativeModule || !isRunning) {
        return;
      }

      nativeModule.stop();
      subscription?.remove();
      subscription = null;
      isRunning = false;
    },

    onTick(callback: () => void) {
      listeners.add(callback);

      return () => {
        listeners.delete(callback);
      };
    },

    isRunning() {
      return isRunning;
    },
  };
}
