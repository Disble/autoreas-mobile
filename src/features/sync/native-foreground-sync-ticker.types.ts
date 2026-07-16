/** Defines the JS-facing seam over the native foreground-sync tick source. */
export interface ForegroundSyncTicker {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
  readonly onTick: (callback: () => void) => () => void;
  readonly isRunning: () => boolean;
}

/** Defines the raw native module surface exposed by the `ForegroundSyncTicker` local Expo module. */
export interface NativeForegroundSyncTickerModule {
  readonly start: (intervalMs: number) => void;
  readonly stop: () => void;
  readonly acknowledgeTick: () => void;
  readonly isRunning: () => boolean;
  readonly addListener: (
    eventName: 'onTick',
    listener: () => void,
  ) => { readonly remove: () => void };
}

/** Defines the loader function signature for the optional native ticker module lookup. */
export type RequireOptionalNativeModule = (
  moduleName: string,
) => NativeForegroundSyncTickerModule | null;

/** Defines the data contract for create native foreground sync ticker params. */
export interface CreateNativeForegroundSyncTickerParams {
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}
