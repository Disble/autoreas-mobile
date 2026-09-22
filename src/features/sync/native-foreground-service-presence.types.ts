import type { OptionalNativeModuleLoader } from './native-module-loader/native-module-loader.types';

/**
 * Defines the JS-facing seam over the native foreground-service presence check. Synchronous,
 * matching the native module's `Function` (not `AsyncFunction`) declaration -- this is a status
 * read, not a control-flow dependency, so it must never block a headless caller.
 */
export interface NativeForegroundServicePresence {
  readonly isForegroundServiceRunning: (channelId: string) => boolean;
}

/**
 * Defines the raw native module surface this seam depends on, exposed by the
 * `ForegroundSyncTicker` local Expo module alongside the tick source and the battery-optimization
 * exemption. Contractually never-throwing on the native side; this seam still degrades to `false`
 * if the module or the lookup itself is unavailable.
 */
export interface NativeForegroundServicePresenceModule {
  readonly isForegroundServiceRunning: (channelId: string) => boolean;
}

/** Defines the loader function signature for the optional native foreground-service presence module lookup. */
export type RequireOptionalNativeModule =
  OptionalNativeModuleLoader<NativeForegroundServicePresenceModule>;

/** Defines the data contract for create native foreground service presence params. */
export interface CreateNativeForegroundServicePresenceParams {
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}
