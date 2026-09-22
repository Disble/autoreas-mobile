/**
 * Provides the registered name of the native module that exposes the foreground-service
 * presence check -- the same `ForegroundSyncTicker` local Expo module that supplies the tick
 * source, the alarm re-arm, and the battery-optimization exemption (see that module's class doc
 * for why one module owns all four).
 */
export const FOREGROUND_SERVICE_PRESENCE_NATIVE_MODULE_NAME = 'ForegroundSyncTicker';
