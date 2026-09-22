/**
 * Provides the registered name of the native module that exposes the battery-optimization
 * exemption surface -- the same `ForegroundSyncTicker` local Expo module that supplies the tick
 * source and the alarm re-arm (see that module's class doc for why one module owns all three).
 */
export const BATTERY_OPTIMIZATION_NATIVE_MODULE_NAME = 'ForegroundSyncTicker';
