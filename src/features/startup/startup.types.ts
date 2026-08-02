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
}

/** Defines the startup application hook contract. */
export interface UseStartupResult {
  readonly databaseName: string;
  readonly handleDatabaseInit: (rawDb: SQLiteDatabase) => Promise<void>;
  readonly isReady: boolean;
  readonly sqliteOptions: { readonly enableChangeListener: boolean };
  readonly sqliteProvider: ComponentType<SQLiteProviderProps> | null;
  readonly startupState: StartupState;
}
