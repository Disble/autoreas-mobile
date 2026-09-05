import type { ComponentType } from 'react';
import type { SQLiteDatabase, SQLiteProviderProps } from 'expo-sqlite';

import { EXPO_SQLITE_UNAVAILABLE_MESSAGE, NATIVE_RUNTIME_CACHE } from './native-runtime.constants';
import type {
  DrizzleExpoSQLiteModule,
  DrizzleLiveQueryResult,
  DrizzleMigratorModule,
  ExpoSQLiteModule,
  OptionalLiveQueryStatus,
} from './native-runtime.types';

/** Reports whether an error means expo-sqlite is absent from this binary rather than broken. */
function shouldTreatAsUnavailable(error: unknown) {
  return error instanceof Error && /ExpoSQLite|expo-sqlite/i.test(error.message);
}

/** Reports whether an error means the caller rendered outside an SQLiteProvider. */
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

/** Resolves the expo-sqlite module once, or null when the binary does not ship it. */
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

/** Resolves the drizzle Expo SQLite bindings once, or null when they are unavailable. */
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

/** Resolves the drizzle migrator binding once, or null when it is unavailable. */
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

/** Reads the SQLite context hook when it exists, falling back to null without a native module. */
function readSQLiteContextOrNull(): SQLiteDatabase | null {
  const readContext = loadExpoSQLiteModule()?.useSQLiteContext ?? (() => null);
  return readContext();
}

/** Reads drizzle's live query, or null when the binary does not ship its bindings at all. */
function readLiveQueryOrNull(query: unknown): DrizzleLiveQueryResult | null {
  const readLiveQuery = loadDrizzleExpoSQLiteModule()?.useLiveQuery as
    | ((input: unknown) => DrizzleLiveQueryResult)
    | undefined;

  return readLiveQuery ? readLiveQuery(query) : null;
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

/**
 * Coordinates optional live query state and actions.
 * `status` describes the query's own answer state, because drizzle seeds a live query with an
 * empty result set: reading that first render as durable truth is what made callers act on data
 * nobody had read yet. `unavailable` is deliberately distinct from `pending` -- a rejected query
 * never stamps a result, so a caller waiting for one would wait for the rest of the session.
 */
export function useOptionalLiveQuery<TResult>(
  query: unknown,
  fallbackData: TResult,
): { data: TResult; status: OptionalLiveQueryStatus } {
  try {
    const result = readLiveQueryOrNull(query);

    if (!result) {
      return { data: fallbackData, status: 'unavailable' };
    }

    const data = (result.data as TResult | undefined) ?? fallbackData;

    if (result.error != null) {
      return { data, status: 'unavailable' };
    }

    return { data, status: result.updatedAt != null ? 'loaded' : 'pending' };
  } catch (error) {
    if (shouldTreatAsMissingProvider(error) || shouldTreatAsUnavailable(error)) {
      return { data: fallbackData, status: 'unavailable' };
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
