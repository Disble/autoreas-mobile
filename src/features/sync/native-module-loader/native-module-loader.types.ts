/**
 * Defines the loader signature every native-sync seam uses for its optional native module
 * lookup, generic over the module surface each seam declares: `(moduleName) => TModule | null`
 * mirrors `expo-modules-core`'s `requireOptionalNativeModule`, where `null` means "this host has
 * no such native module" rather than an error.
 */
export type OptionalNativeModuleLoader<TModule> = (moduleName: string) => TModule | null;
