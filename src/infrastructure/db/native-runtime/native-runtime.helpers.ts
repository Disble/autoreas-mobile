import type { ComponentType } from 'react';
import type { SQLiteDatabase, SQLiteProviderProps } from 'expo-sqlite';

import { EXPO_SQLITE_UNAVAILABLE_MESSAGE, NATIVE_RUNTIME_CACHE } from './native-runtime.constants';
import type { DrizzleExpoSQLiteModule, DrizzleMigratorModule, ExpoSQLiteModule } from './native-runtime.types';

function shouldTreatAsUnavailable(error: unknown) {
  return error instanceof Error && /ExpoSQLite|expo-sqlite/i.test(error.message);
}

function shouldTreatAsMissingProvider(error: unknown) {
  return error instanceof Error && /SQLiteProvider/i.test(error.message);
}

/** Loads an optional native module once, caching unavailable modules without hiding unrelated errors. */
export function loadCachedNativeModule<TModule>(
  cachedModule: TModule | null | undefined,
  loadModule: () => TModule,
  cacheModule: (module: TModule | null) => void,
): TModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    const loadedModule = loadModule();
    cacheModule(loadedModule);
    return loadedModule;
  } catch (error) {
    if (!shouldTreatAsUnavailable(error)) {
      throw error;
    }

    cacheModule(null);
    return null;
  }
}

function loadExpoSQLiteModule() {
  return loadCachedNativeModule(
    NATIVE_RUNTIME_CACHE.expoSQLite,
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when expo-sqlite is unavailable in the current binary.
      return require('expo-sqlite') as ExpoSQLiteModule;
    },
    (module) => {
      NATIVE_RUNTIME_CACHE.expoSQLite = module;
    },
  );
}

function loadDrizzleExpoSQLiteModule() {
  return loadCachedNativeModule(
    NATIVE_RUNTIME_CACHE.drizzleExpoSQLite,
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when drizzle Expo SQLite bindings are unavailable.
      return require('drizzle-orm/expo-sqlite') as DrizzleExpoSQLiteModule;
    },
    (module) => {
      NATIVE_RUNTIME_CACHE.drizzleExpoSQLite = module;
    },
  );
}

function loadDrizzleMigratorModule() {
  return loadCachedNativeModule(
    NATIVE_RUNTIME_CACHE.drizzleMigrator,
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when the migrator binding is unavailable.
      return require('drizzle-orm/expo-sqlite/migrator') as DrizzleMigratorModule;
    },
    (module) => {
      NATIVE_RUNTIME_CACHE.drizzleMigrator = module;
    },
  );
}

/** Executes the get expo sqlite unavailable error operation. */
export function getExpoSQLiteUnavailableError() {
  return new Error(EXPO_SQLITE_UNAVAILABLE_MESSAGE);
}

/** Executes the get sqlite provider operation. */
export function getSQLiteProvider(): ComponentType<SQLiteProviderProps> | null {
  return loadExpoSQLiteModule()?.SQLiteProvider ?? null;
}

function readSQLiteContextOrNull(): SQLiteDatabase | null {
  const readContext = loadExpoSQLiteModule()?.useSQLiteContext ?? (() => null);
  return readContext();
}

function readLiveQueryOrFallback(query: unknown): { data: unknown } {
  const readLiveQuery = loadDrizzleExpoSQLiteModule()?.useLiveQuery as
    | ((input: unknown) => { data: unknown })
    | undefined;
  return readLiveQuery?.(query) ?? { data: undefined };
}

/** Coordinates optional sqlite context state and actions. */
export function useOptionalSQLiteContext(): SQLiteDatabase | null {
  try {
    return readSQLiteContextOrNull();
  } catch (error) {
    if (shouldTreatAsMissingProvider(error) || shouldTreatAsUnavailable(error)) {
      return null;
    }

    throw error;
  }
}

/** Coordinates optional live query state and actions. */
export function useOptionalLiveQuery<TResult>(query: unknown, fallbackData: TResult) {
  try {
    const result = readLiveQueryOrFallback(query) as { data: TResult | undefined };

    return { data: result.data ?? fallbackData };
  } catch (error) {
    if (shouldTreatAsMissingProvider(error) || shouldTreatAsUnavailable(error)) {
      return { data: fallbackData };
    }

    throw error;
  }
}

/** Executes the get open database sync operation. */
export function getOpenDatabaseSync() {
  const expoSQLiteModule = loadExpoSQLiteModule();

  if (!expoSQLiteModule?.openDatabaseSync) {
    throw getExpoSQLiteUnavailableError();
  }

  return expoSQLiteModule.openDatabaseSync;
}

/** Executes the get drizzle factory operation. */
export function getDrizzleFactory() {
  const drizzleExpoSQLiteModule = loadDrizzleExpoSQLiteModule();

  if (!drizzleExpoSQLiteModule?.drizzle) {
    throw getExpoSQLiteUnavailableError();
  }

  return drizzleExpoSQLiteModule.drizzle;
}

/** Executes the get drizzle migrator operation. */
export function getDrizzleMigrator() {
  const drizzleMigratorModule = loadDrizzleMigratorModule();

  if (!drizzleMigratorModule?.migrate) {
    throw getExpoSQLiteUnavailableError();
  }

  return drizzleMigratorModule.migrate;
}
