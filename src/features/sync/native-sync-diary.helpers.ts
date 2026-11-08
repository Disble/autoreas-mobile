import { FOREGROUND_SYNC_TICKER_NATIVE_MODULE_NAME } from './native-foreground-sync-ticker.constants';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from './native-module-loader/native-module-loader.helpers';
import type {
  CreateNativeForegroundSyncTickerParams,
  NativeForegroundSyncTickerModule,
  NativeSyncDiary,
} from './native-foreground-sync-ticker.types';
/**
 * Runs one native diary call best effort: a synchronous throw and a rejected promise are both
 * swallowed, because a diary failure must never reach the sync attempt it describes.
 */
function callDiaryBestEffort(call: () => Promise<void> | undefined): void {
  try {
    void call()?.catch(() => undefined);
  } catch {
    // Swallowed by contract: see the function doc.
  }
}

/**
 * Creates the JS-side seam over the native sync diary on the same `ForegroundSyncTicker` module
 * (odd/tasks/mobile-report-kinds.md T2). JS counts its sync attempts through the native writer
 * both engines use; the native side validates the vocabulary, applies the outbox limits and
 * swallows its own failures.
 *
 * Degrades to a no-op when the native module is unavailable or predates the diary methods, and
 * never throws or rejects.
 */
export function createNativeSyncDiary(
  params: CreateNativeForegroundSyncTickerParams = {},
): NativeSyncDiary {
  const loadModule =
    params.requireOptionalNativeModule ??
    loadDefaultOptionalNativeModuleLoader<NativeForegroundSyncTickerModule>();
  const nativeModule = loadOptionalNativeModule(
    loadModule,
    FOREGROUND_SYNC_TICKER_NATIVE_MODULE_NAME,
  );

  return {
    recordSyncAttempt(triggerSource, outcome, durationMs) {
      callDiaryBestEffort(() => nativeModule?.recordSyncAttempt?.(triggerSource, outcome, durationMs));
    },

    recordRuntimeTransition(subject, transition, reason) {
      callDiaryBestEffort(() =>
        nativeModule?.recordRuntimeTransition?.(subject, transition, reason ?? null),
      );
    },
  };
}
