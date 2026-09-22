import type { OptionalNativeModuleLoader } from './native-module-loader/native-module-loader.types';

/**
 * Defines the JS-facing seam over the native battery-optimization exemption surface. Both
 * operations are synchronous, matching the native module's `Function` (not `AsyncFunction`)
 * declarations -- `requestExemption()` only reports whether the system intent was launched, not
 * whether the user granted it, so callers must re-read `isExempt()` to observe the outcome.
 */
export interface BatteryOptimizationExemption {
  readonly isExempt: () => boolean;
  readonly requestExemption: () => boolean;
}

/**
 * Defines the raw native module surface this seam depends on, exposed by the
 * `ForegroundSyncTicker` local Expo module alongside the tick source. Both functions are
 * contractually never-throwing on the native side; this seam still degrades to `false` if the
 * module or the lookup itself is unavailable.
 */
export interface NativeBatteryOptimizationModule {
  readonly isIgnoringBatteryOptimizations: () => boolean;
  readonly requestIgnoreBatteryOptimizations: () => boolean;
}

/** Defines the loader function signature for the optional native battery-optimization module lookup. */
export type RequireOptionalNativeModule =
  OptionalNativeModuleLoader<NativeBatteryOptimizationModule>;

/** Defines the data contract for create native battery optimization exemption params. */
export interface CreateNativeBatteryOptimizationExemptionParams {
  readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
}
