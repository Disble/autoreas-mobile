import { BATTERY_OPTIMIZATION_NATIVE_MODULE_NAME } from './native-battery-optimization.constants';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from './native-module-loader/native-module-loader.helpers';
import type {
  BatteryOptimizationExemption,
  CreateNativeBatteryOptimizationExemptionParams,
  NativeBatteryOptimizationModule,
} from './native-battery-optimization.types';

// The lazily-required `expo-modules-core` loader and the guarded null lookup live in
// `native-module-loader/`, shared by the ticker, sync-engine, sync-journal, and this seam.

/**
 * Creates the JS-side seam over the native battery-optimization exemption surface. The surface
 * lives on the same `ForegroundSyncTicker` local Expo module as the tick source (see that
 * module's class doc for why); this seam is independent of `createNativeForegroundSyncTicker`
 * because the two capabilities have unrelated lifecycles -- the exemption can be read or
 * requested at any time, with no `start`/`stop` pairing.
 *
 * When the native module is unavailable (Expo Go, iOS, or a non-prebuilt binary) this degrades
 * to `isExempt() === false` and `requestExemption() === false` instead of crashing, matching the
 * degrade-honestly contract every native-sync seam follows.
 */
export function createNativeBatteryOptimizationExemption(
  params: CreateNativeBatteryOptimizationExemptionParams = {},
): BatteryOptimizationExemption {
  const loadModule =
    params.requireOptionalNativeModule ??
    loadDefaultOptionalNativeModuleLoader<NativeBatteryOptimizationModule>();
  const nativeModule = loadOptionalNativeModule(
    loadModule,
    BATTERY_OPTIMIZATION_NATIVE_MODULE_NAME,
  );

  return {
    isExempt() {
      return nativeModule?.isIgnoringBatteryOptimizations() ?? false;
    },

    requestExemption() {
      return nativeModule?.requestIgnoreBatteryOptimizations() ?? false;
    },
  };
}
