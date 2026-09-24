import type { OptionalNativeModuleLoader } from './native-module-loader/native-module-loader.types';

/**
 * Defines the JS-facing seam over the native foreground-sync tick source. Native owns tick
 * dispatch and cycle execution entirely (ODD native-foreground-sync-service T3+T4+T5): this seam
 * only starts/stops native ticking and reads whether it is currently armed, it no longer receives
 * ticks in JS.
 */
export interface ForegroundSyncTicker {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
  readonly isRunning: () => boolean;
}

/**
 * Defines the raw native module surface exposed by the `ForegroundSyncTicker` local Expo module.
 */
export interface NativeForegroundSyncTickerModule {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
  readonly isRunning: () => boolean;
}

/** Defines the loader function signature for the optional native ticker module lookup. */
export type RequireOptionalNativeModule =
  OptionalNativeModuleLoader<NativeForegroundSyncTickerModule>;

/** Defines the data contract for create native foreground sync ticker params. */
export interface CreateNativeForegroundSyncTickerParams {
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}
