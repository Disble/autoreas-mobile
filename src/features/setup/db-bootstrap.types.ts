import type { Href } from "expo-router";
import type { SQLiteDatabase, SQLiteProviderProps } from "expo-sqlite";
import type { ComponentType } from "react";

/** Defines the boot target value shape. */
export type BootTarget = Href;

/** Defines the startup failure payload shown after bootstrap rejects. */
export interface BootstrapFailure {
  readonly diagnosticMessage: string;
  readonly recoveryHint: string;
}

/** Defines the data contract for boot state. */
export interface BootState {
  readonly failure: BootstrapFailure | null;
  readonly initialized: boolean;
  readonly target: BootTarget | null;
}

/** Defines the data contract for use db bootstrap result. */
export interface UseDbBootstrapResult {
  readonly bootState: BootState;
  readonly databaseName: string;
  readonly handleDatabaseInit: (rawDb: SQLiteDatabase) => Promise<void>;
  readonly sqliteOptions: { readonly enableChangeListener: boolean };
  readonly sqliteProvider: ComponentType<SQLiteProviderProps> | null;
}
