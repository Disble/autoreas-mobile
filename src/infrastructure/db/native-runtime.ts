import type { ComponentType } from 'react';
import type { SQLiteDatabase, SQLiteProviderProps } from 'expo-sqlite';

type ExpoSQLiteModule = typeof import('expo-sqlite');
type DrizzleExpoSQLiteModule = typeof import('drizzle-orm/expo-sqlite');
type DrizzleMigratorModule = typeof import('drizzle-orm/expo-sqlite/migrator');

let expoSQLiteModuleCache: ExpoSQLiteModule | null | undefined;
let drizzleExpoSQLiteModuleCache: DrizzleExpoSQLiteModule | null | undefined;
let drizzleMigratorModuleCache: DrizzleMigratorModule | null | undefined;

export const EXPO_SQLITE_UNAVAILABLE_MESSAGE =
  'Expo SQLite no esta disponible en este binario. Usa un development build o recompila la app nativa despues de agregar expo-sqlite.';

function shouldTreatAsUnavailable(error: unknown) {
  return error instanceof Error && /ExpoSQLite|expo-sqlite/i.test(error.message);
}

function shouldTreatAsMissingProvider(error: unknown) {
  return error instanceof Error && /SQLiteProvider/i.test(error.message);
}

function loadExpoSQLiteModule() {
  if (expoSQLiteModuleCache !== undefined) {
    return expoSQLiteModuleCache;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when expo-sqlite is unavailable in the current binary.
    expoSQLiteModuleCache = require('expo-sqlite') as ExpoSQLiteModule;
  } catch (error) {
    if (!shouldTreatAsUnavailable(error)) {
      throw error;
    }

    expoSQLiteModuleCache = null;
  }

  return expoSQLiteModuleCache;
}

function loadDrizzleExpoSQLiteModule() {
  if (drizzleExpoSQLiteModuleCache !== undefined) {
    return drizzleExpoSQLiteModuleCache;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when drizzle Expo SQLite bindings are unavailable.
    drizzleExpoSQLiteModuleCache = require('drizzle-orm/expo-sqlite') as DrizzleExpoSQLiteModule;
  } catch (error) {
    if (!shouldTreatAsUnavailable(error)) {
      throw error;
    }

    drizzleExpoSQLiteModuleCache = null;
  }

  return drizzleExpoSQLiteModuleCache;
}

function loadDrizzleMigratorModule() {
  if (drizzleMigratorModuleCache !== undefined) {
    return drizzleMigratorModuleCache;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime lazy loading preserves graceful fallback when the migrator binding is unavailable.
    drizzleMigratorModuleCache = require('drizzle-orm/expo-sqlite/migrator') as DrizzleMigratorModule;
  } catch (error) {
    if (!shouldTreatAsUnavailable(error)) {
      throw error;
    }

    drizzleMigratorModuleCache = null;
  }

  return drizzleMigratorModuleCache;
}

export function getExpoSQLiteUnavailableError() {
  return new Error(EXPO_SQLITE_UNAVAILABLE_MESSAGE);
}

export function getSQLiteProvider(): ComponentType<SQLiteProviderProps> | null {
  return loadExpoSQLiteModule()?.SQLiteProvider ?? null;
}

function readSQLiteContextUnavailableFallback() {
  return null;
}

const readSQLiteContextOrNull: () => SQLiteDatabase | null =
  loadExpoSQLiteModule()?.useSQLiteContext ?? readSQLiteContextUnavailableFallback;

function readLiveQueryUnavailableFallback<TResult>() {
  return { data: undefined as TResult | undefined };
}

const readLiveQueryOrFallback: (query: unknown) => { data: unknown } =
  (loadDrizzleExpoSQLiteModule()?.useLiveQuery as ((query: unknown) => { data: unknown }) | undefined) ??
  readLiveQueryUnavailableFallback;

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

export function useOptionalLiveQuery<TResult>(query: unknown, fallbackData: TResult) {
  try {
    const result = readLiveQueryOrFallback(query as any) as { data: TResult | undefined };

    return { data: result.data ?? fallbackData };
  } catch (error) {
    if (shouldTreatAsMissingProvider(error) || shouldTreatAsUnavailable(error)) {
      return { data: fallbackData };
    }

    throw error;
  }
}

export function getOpenDatabaseSync() {
  const expoSQLiteModule = loadExpoSQLiteModule();

  if (!expoSQLiteModule?.openDatabaseSync) {
    throw getExpoSQLiteUnavailableError();
  }

  return expoSQLiteModule.openDatabaseSync;
}

export function getDrizzleFactory() {
  const drizzleExpoSQLiteModule = loadDrizzleExpoSQLiteModule();

  if (!drizzleExpoSQLiteModule?.drizzle) {
    throw getExpoSQLiteUnavailableError();
  }

  return drizzleExpoSQLiteModule.drizzle;
}

export function getDrizzleMigrator() {
  const drizzleMigratorModule = loadDrizzleMigratorModule();

  if (!drizzleMigratorModule?.migrate) {
    throw getExpoSQLiteUnavailableError();
  }

  return drizzleMigratorModule.migrate;
}
