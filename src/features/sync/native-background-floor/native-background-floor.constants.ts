/**
 * Registered name of the local Expo module that owns the native background floor, matching the
 * `Name("SyncEngine")` declared by `modules/sync-engine`'s Kotlin `SyncEngineModule`.
 *
 * The floor shares that module with `runOnce` instead of shipping a second local module: the
 * scheduler and its status live in the same Kotlin package as the cycle they trigger, and one
 * module name means one `requireOptionalNativeModule` answer for the whole native sync surface.
 */
export const NATIVE_BACKGROUND_FLOOR_MODULE_NAME = "SyncEngine";
