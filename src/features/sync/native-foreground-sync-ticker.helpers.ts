import { FOREGROUND_SYNC_TICKER_NATIVE_MODULE_NAME } from './native-foreground-sync-ticker.constants';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from './native-module-loader/native-module-loader.helpers';
import type {
  CreateNativeForegroundSyncTickerParams,
  ForegroundSyncTicker,
  ForegroundSyncTickListener,
  NativeForegroundSyncTickerModule,
} from './native-foreground-sync-ticker.types';

// The lazily-required `expo-modules-core` loader and the guarded null lookup live in
// `native-module-loader/`, shared by the ticker, sync-engine, and sync-journal seams.

/** Answers whether the value is a promise-like object, so sync listeners keep working unchanged. */
function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Creates the JS-side seam over the native foreground-sync ticker module.
 * When the native module is unavailable (Expo Go, iOS, or a non-prebuilt binary) this degrades
 * to a no-op ticker instead of crashing -- the FGS simply runs without a native tick source until
 * a native build is installed; callers can observe this via `isRunning()` staying false.
 *
 * The native wake lock is scoped to the cycle: the native module acquires it when a tick is
 * dispatched, and this helper reports completion through `notifyCycleComplete()` once every
 * cycle promise that tick produced has settled (rejections settle too), so a rejected cycle
 * also releases the lock. The native side still bounds the hold with a safety-net timeout for
 * a cycle that never reports back.
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
  const listeners = new Set<ForegroundSyncTickListener>();
  let subscription: { remove: () => void } | null = null;
  let isRunning = false;

  /** Reports one dispatched tick's cycles as settled to the native wake-lock owner. */
  function notifyCycleComplete(): void {
    nativeModule?.notifyCycleComplete();
  }

  function notifyListeners() {
    const cyclePromises: Promise<unknown>[] = [];

    listeners.forEach((listener) => {
      const result: unknown = listener();
      if (isPromiseLike(result)) {
        cyclePromises.push(result);
      }
    });

    if (cyclePromises.length === 0) {
      notifyCycleComplete();
      return;
    }

    // `allSettled` waits for every cycle of the tick (rejections included) before the single
    // per-tick release, matching the native side's one wake-lock reference per dispatched tick.
    void Promise.allSettled(cyclePromises).then(() => {
      notifyCycleComplete();
    });
  }

  return {
    start(intervalMs: number) {
      if (!nativeModule || isRunning) {
        return;
      }

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

    onTick(callback: ForegroundSyncTickListener) {
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
