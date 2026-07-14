import type { NativeRuntimeCache } from './native-runtime.types';

/** Explains how to recover when Expo SQLite is absent from the native binary. */
export const EXPO_SQLITE_UNAVAILABLE_MESSAGE =
  'Expo SQLite no esta disponible en este binario. Usa un development build o recompila la app nativa despues de agregar expo-sqlite.';

/** Caches optional native modules after their first synchronous resolution. */
export const NATIVE_RUNTIME_CACHE: NativeRuntimeCache = {
  expoSQLite: undefined,
  drizzleExpoSQLite: undefined,
  drizzleMigrator: undefined,
};
