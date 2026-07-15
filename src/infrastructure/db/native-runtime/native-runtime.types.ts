/** Defines the lazily loaded Expo SQLite module. */
export type ExpoSQLiteModule = typeof import('expo-sqlite');

/** Defines the lazily loaded Drizzle Expo SQLite module. */
export type DrizzleExpoSQLiteModule = typeof import('drizzle-orm/expo-sqlite');

/** Defines the lazily loaded Drizzle migrator module. */
export type DrizzleMigratorModule = typeof import('drizzle-orm/expo-sqlite/migrator');

/** Defines the mutable cache used by synchronous native-module accessors. */
export interface NativeRuntimeCache {
  expoSQLite: ExpoSQLiteModule | null | undefined;
  drizzleExpoSQLite: DrizzleExpoSQLiteModule | null | undefined;
  drizzleMigrator: DrizzleMigratorModule | null | undefined;
}
