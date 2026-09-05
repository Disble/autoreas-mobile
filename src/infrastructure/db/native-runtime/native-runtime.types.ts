/** Defines the lazily loaded Expo SQLite module. */
export type ExpoSQLiteModule = typeof import('expo-sqlite');

/** Defines the lazily loaded Drizzle Expo SQLite module. */
export type DrizzleExpoSQLiteModule = typeof import('drizzle-orm/expo-sqlite');

/** Defines the lazily loaded Drizzle migrator module. */
export type DrizzleMigratorModule = typeof import('drizzle-orm/expo-sqlite/migrator');

/**
 * Defines what drizzle's `useLiveQuery` hands back, including the fields it leaves unset.
 * `updatedAt` is stamped only when a result actually lands, and `error` only when the query
 * rejected; the two together are how a caller tells a pending read from one that failed.
 */
export interface DrizzleLiveQueryResult {
  readonly data: unknown;
  readonly updatedAt?: Date | null;
  readonly error?: unknown;
}

/**
 * Defines the answer state of an optional live query.
 * `pending` means the query has not answered yet, `loaded` that it has, and `unavailable` that it
 * never will -- it rejected, its bindings are missing, or the caller is outside a provider.
 */
export type OptionalLiveQueryStatus = 'pending' | 'loaded' | 'unavailable';

/** Defines the mutable cache used by synchronous native-module accessors. */
export interface NativeRuntimeCache {
  expoSQLite: ExpoSQLiteModule | null | undefined;
  drizzleExpoSQLite: DrizzleExpoSQLiteModule | null | undefined;
  drizzleMigrator: DrizzleMigratorModule | null | undefined;
}
