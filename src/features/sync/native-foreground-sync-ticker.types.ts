import type { OptionalNativeModuleLoader } from './native-module-loader/native-module-loader.types';

/**
 * Defines the JS-facing seam over the native foreground-sync tick source. Native owns tick
 * dispatch and cycle execution entirely (ODD native-foreground-sync-service T3+T4+T5): this seam
 * only starts/stops native ticking, it no longer receives ticks in JS.
 */
export interface ForegroundSyncTicker {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
}

/**
 * Defines the raw native module surface exposed by the `ForegroundSyncTicker` local Expo module.
 * The two diary methods are optional because a binary built before them does not declare them.
 */
export interface NativeForegroundSyncTickerModule {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
  readonly recordSyncAttempt?: (
    triggerSource: string,
    outcome: string,
    durationMs: number,
  ) => Promise<void>;
  readonly recordRuntimeTransition?: (
    subject: string,
    transition: string,
    reason: string | null,
  ) => Promise<void>;
}

/**
 * Defines the JS-facing seam over the native sync diary (odd/tasks/mobile-report-kinds.md T2):
 * best-effort records the native `SyncDiary` validates and counts. Neither method throws nor
 * returns anything to wait on.
 */
export interface NativeSyncDiary {
  readonly recordSyncAttempt: (triggerSource: string, outcome: string, durationMs: number) => void;
  readonly recordRuntimeTransition: (subject: string, transition: string, reason?: string) => void;
}

/** Defines the loader function signature for the optional native ticker module lookup. */
export type RequireOptionalNativeModule =
  OptionalNativeModuleLoader<NativeForegroundSyncTickerModule>;

/** Defines the data contract for create native foreground sync ticker params. */
export interface CreateNativeForegroundSyncTickerParams {
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}
