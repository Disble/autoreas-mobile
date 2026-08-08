import { FOREGROUND_SYNC_TICKER_NATIVE_MODULE_NAME } from './native-foreground-sync-ticker.constants';
import type {
  CreateNativeForegroundSyncTickerParams,
  ForegroundSyncTicker,
  NativeForegroundSyncTickerModule,
  RequireOptionalNativeModule,
} from './native-foreground-sync-ticker.types';

/**
 * Lazily loads `expo-modules-core`'s `requireOptionalNativeModule` only when a ticker is actually
 * constructed. `expo-modules-core` touches `Platform` at import time, which can throw in narrowly
 * mocked test environments (or non-Expo runtimes) that never expect this dependency -- deferring
 * the require, and wrapping it in try/catch, keeps every unrelated consumer of this module
 * (including callers that never build a ticker) unaffected by that native surface.
 */
function loadDefaultRequireOptionalNativeModule(): RequireOptionalNativeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when expo-modules-core is unavailable or its native surface is unmocked.
    const expoModulesCore = require('expo-modules-core') as {
      requireOptionalNativeModule: RequireOptionalNativeModule;
    };

    return expoModulesCore.requireOptionalNativeModule;
  } catch {
    return null;
  }
}

function loadNativeForegroundSyncTickerModule(
  loadModule: RequireOptionalNativeModule | null,
): NativeForegroundSyncTickerModule | null {
  if (!loadModule) {
    return null;
  }

  try {
    return loadModule(FOREGROUND_SYNC_TICKER_NATIVE_MODULE_NAME);
  } catch {
    // requireOptionalNativeModule already returns null when the module is simply missing;
    // this guard only protects against unexpected native-bridge lookup failures (e.g. Expo Go).
    return null;
  }
}

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
    params.requireOptionalNativeModule ?? loadDefaultRequireOptionalNativeModule();
  const nativeModule = loadNativeForegroundSyncTickerModule(loadModule);
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
