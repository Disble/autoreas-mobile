import type { OptionalNativeModuleLoader } from './native-module-loader.types';

/**
 * Lazily loads `expo-modules-core`'s `requireOptionalNativeModule` only when a native-sync seam
 * (ticker, sync-engine, or sync-journal) is actually constructed.
 *
 * Why this pattern exists at all: every native-sync seam must degrade gracefully instead of
 * crashing when the native module is unavailable -- Expo Go, iOS (where the local modules are
 * not compiled in), or any non-prebuilt binary. `expo-modules-core` touches `Platform` at
 * import time, which can throw in narrowly mocked test environments (or non-Expo runtimes) that
 * never expect this dependency -- deferring the require, and wrapping it in try/catch, keeps
 * every unrelated consumer of a seam's module (including callers that never construct the seam)
 * unaffected by that native surface.
 *
 * @typeparam TModule - The native module surface the calling seam declares.
 * @returns The `requireOptionalNativeModule` lookup, or `null` when `expo-modules-core` itself
 * cannot be loaded.
 */
export function loadDefaultOptionalNativeModuleLoader<TModule>(): OptionalNativeModuleLoader<TModule> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when expo-modules-core is unavailable or its native surface is unmocked.
    const expoModulesCore = require('expo-modules-core') as {
      requireOptionalNativeModule: OptionalNativeModuleLoader<TModule>;
    };

    return expoModulesCore.requireOptionalNativeModule;
  } catch {
    return null;
  }
}

/**
 * Resolves a seam's native module through the injected (or lazily defaulted) loader, and
 * answers `null` for every way the lookup can fail -- a missing loader, a missing module, or an
 * unexpected native-bridge error -- so each seam has one uniform "unavailable" signal to
 * degrade on (Expo Go, iOS, and non-prebuilt binaries included).
 *
 * @typeparam TModule - The native module surface the calling seam declares.
 * @param loadModule - The injected loader, or `null` when even `expo-modules-core` was
 * unloadable.
 * @param moduleName - The registered name of the seam's native Expo module.
 * @returns The native module, or `null` when it is unavailable.
 */
export function loadOptionalNativeModule<TModule>(
  loadModule: OptionalNativeModuleLoader<TModule> | null,
  moduleName: string,
): TModule | null {
  if (!loadModule) {
    warnModuleUnavailableOnce(moduleName, 'expo-modules-core is unavailable');
    return null;
  }

  try {
    const nativeModule = loadModule(moduleName);

    if (!nativeModule) {
      warnModuleUnavailableOnce(moduleName, 'the native module is missing');
    }

    return nativeModule;
  } catch {
    // requireOptionalNativeModule already returns null when the module is simply missing;
    // this guard only protects against unexpected native-bridge lookup failures (e.g. Expo Go).
    warnModuleUnavailableOnce(moduleName, 'the native-bridge lookup threw');
    return null;
  }
}

/**
 * Warns exactly once per JS runtime that a native-sync seam degraded to its no-op path.
 *
 * The degradation is otherwise completely silent, and silence is indistinguishable from a healthy
 * module that simply has not fired yet: on device a foreground service can sit `isForeground=true`
 * with its notification posted while its ticker seam no-ops, which is exactly how background sync
 * stayed dead for hours with no error anywhere. Degrading quietly is right; degrading invisibly is
 * not. The flag lives on `globalThis` because this repo's role-file-shape rule allows a `.helpers`
 * file to declare only types and functions.
 *
 * @param moduleName - The native module whose absence degraded the seam.
 * @param reason - How the lookup failed, for the warning line.
 */
function warnModuleUnavailableOnce(moduleName: string, reason: string): void {
  const flags = globalThis as { __nativeSyncSeamsWarned?: Record<string, boolean> };
  const warned = (flags.__nativeSyncSeamsWarned ??= {});

  if (warned[moduleName]) {
    return;
  }

  warned[moduleName] = true;

  try {
    console.warn(`[nativeSeam] ${moduleName} unavailable (${reason}); this seam degrades to a no-op`);
  } catch {
    // A runtime without console must not fail here: this is a diagnostic, not control flow.
  }
}
