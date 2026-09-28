import type { Href } from 'expo-router';
import type { SQLiteDatabase, SQLiteProviderProps } from 'expo-sqlite';
import type { ComponentType, Dispatch, SetStateAction } from 'react';

/** Names the bounded local startup stages exposed by safe diagnostics. */
export type StartupDiagnosticStage =
  | 'database_preparation'
  | 'font_loading'
  | 'local_config'
  | 'provider_readiness';

/** Names safe startup failure categories. */
export type StartupFailureClassification =
  | 'busy'
  | 'corruption'
  | 'incompatible_schema'
  | 'schema_validation'
  | 'sqlite'
  | 'unknown';

/** Defines the redacted diagnostic emitted for controlled startup failures. */
export interface StartupDiagnostic {
  readonly stage: StartupDiagnosticStage;
  readonly code: string | null;
  readonly classification: StartupFailureClassification;
}

/** Defines the controlled startup failure presented after local readiness fails. */
export interface StartupFailure {
  readonly diagnostic: StartupDiagnostic;
  readonly diagnosticMessage: string;
  readonly recoveryHint: string;
}

/** Names each application startup state. */
export type StartupPhase = 'preparing_database' | 'loading_config' | 'ready' | 'fatal';

/** Defines the application readiness state owned by the startup feature. */
export interface StartupState {
  readonly failure: StartupFailure | null;
  readonly phase: StartupPhase;
  readonly target: Href | null;
}

/** Defines the dependencies used to create the stable SQLiteProvider initialization callback. */
export interface CreateStartupDatabaseInitializerParams {
  readonly setStartupState: Dispatch<SetStateAction<StartupState>>;
  /**
   * Receives the live provider connection the instant `onInit` is handed it, BEFORE preparation.
   *
   * The reset boundary must close the provider's connection before deleting the database. The
   * recovery card renders OUTSIDE `SQLiteProvider` (the fatal card replaces the provider), so the
   * optional SQLite context is null exactly when a reset needs the handle, and the provider's
   * suspense path keeps the connection alive after `onInit` fails. Capturing before preparation is
   * deliberate: a preparation failure is precisely the case the reset exists for.
   */
  readonly onDatabaseOpened?: (database: SQLiteDatabase) => void;
}

/** Defines the startup application hook contract. */
export interface UseStartupResult {
  readonly databaseName: string;
  /**
   * Returns the live connection the provider most recently opened, or `null` before any open.
   *
   * Reads a ref, so calling it never re-renders. It is the only route the reset has to the
   * connection it must close before deletion, because the recovery surface renders outside
   * `SQLiteProvider` and the provider's suspense path does not close the handle on unmount.
   */
  readonly getActiveDatabase: () => SQLiteDatabase | null;
  readonly handleDatabaseInit: (rawDb: SQLiteDatabase) => Promise<void>;
  readonly isReady: boolean;
  /**
   * Discards the current provider mount so the next render opens a genuinely fresh provider.
   *
   * The callback is the only supported way to make the provider reopen the database: `expo-sqlite`
   * caches its connection per initialization callback, so a caller that re-rendered the provider
   * without this would observe the same connection and the same prepared database.
   */
  readonly remountDatabaseProvider: () => void;
  readonly sqliteOptions: { readonly enableChangeListener: boolean };
  readonly sqliteProvider: ComponentType<SQLiteProviderProps> | null;
  readonly startupState: StartupState;
}

/**
 * Names one entry of the ordered error-name rule table: an error name mapped to its classification.
 *
 * The table is walked in order and the first match wins, so the order below is load-bearing:
 * every name rule outranks every code-derived rule.
 */
export type StartupErrorNameRule = readonly [
  name: string,
  classification: StartupFailureClassification,
];

/**
 * Names one entry of the ordered error-code rule table: a set of whitelisted SQLite codes mapped
 * to their classification. The first matching rule wins.
 */
export type StartupErrorCodeRule = readonly [
  codes: readonly string[],
  classification: StartupFailureClassification,
];
