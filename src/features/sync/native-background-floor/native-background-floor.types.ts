import type { OptionalNativeModuleLoader } from "../native-module-loader/native-module-loader.types";

/**
 * Defines the raw, untyped map the native floor operations resolve with. Expo delivers plain
 * dictionaries whose fields cannot be trusted to exist or to have the expected type, so every
 * field is optional and unknown; the normalizer owns the coercion.
 *
 * `ownsBackground` is the Kotlin ticker gate the floor worker itself applies
 * (`SyncTickerOwnership`). It is part of the wire shape for documentation, but this JS seam
 * deliberately does not read it: JS never decides whether the native ticker owns the background.
 */
export type NativeBackgroundFloorStatusMap = {
  readonly registrationStatus?: unknown;
  readonly isBackgroundTaskRegistered?: unknown;
  readonly ownsBackground?: unknown;
};

/**
 * Defines the raw native module surface the `SyncEngine` local Expo module exposes for the
 * native floor. Every operation RESOLVES with the resulting status -- the Kotlin side never
 * rejects -- and reports `unsupported` rather than throwing when no WorkManager can answer.
 */
export interface NativeBackgroundFloorModule {
  readonly registerBackgroundSyncFloor: () => Promise<NativeBackgroundFloorStatusMap>;
  readonly unregisterBackgroundSyncFloor: () => Promise<NativeBackgroundFloorStatusMap>;
  readonly getBackgroundSyncFloorStatus: () => Promise<NativeBackgroundFloorStatusMap>;
}

/** Defines the loader signature for the optional native floor module lookup. */
export type RequireOptionalNativeBackgroundFloorModule =
  OptionalNativeModuleLoader<NativeBackgroundFloorModule>;

/** Defines the data contract for create native background floor strategy params. */
export interface CreateNativeBackgroundFloorStrategyParams {
  /** Test seam: overrides the lazy `expo-modules-core` module lookup. */
  readonly requireOptionalNativeModule?: RequireOptionalNativeBackgroundFloorModule;
}
