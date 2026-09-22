import type { OptionalNativeModuleLoader } from './native-module-loader/native-module-loader.types';

/** Defines the callback the ticker invokes on every native tick. Returning a promise scopes the
 * native per-cycle wake lock to that promise's lifetime: the ticker helper reports completion to
 * the native module when the promise settles (resolves or rejects). */
export type ForegroundSyncTickListener = () => void | Promise<void>;

/** Defines the JS-facing seam over the native foreground-sync tick source. */
export interface ForegroundSyncTicker {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
  readonly onTick: (callback: ForegroundSyncTickListener) => () => void;
  readonly isRunning: () => boolean;
}

/**
 * Defines the raw native module surface exposed by the `ForegroundSyncTicker` local Expo module.
 * `notifyCycleComplete()` releases the per-cycle wake lock the native side acquired when it
 * dispatched the tick; the helper calls it once per tick, after every cycle promise that tick
 * produced has settled.
 */
export interface NativeForegroundSyncTickerModule {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
  readonly isRunning: () => boolean;
  readonly notifyCycleComplete: () => void;
  readonly addListener: (
    eventName: 'onTick',
    listener: ForegroundSyncTickListener,
  ) => { readonly remove: () => void };
}

/** Defines the loader function signature for the optional native ticker module lookup. */
export type RequireOptionalNativeModule =
  OptionalNativeModuleLoader<NativeForegroundSyncTickerModule>;

/** Defines the data contract for create native foreground sync ticker params. */
export interface CreateNativeForegroundSyncTickerParams {
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}
