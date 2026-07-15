import type { Href } from "expo-router";
import type { SQLiteDatabase, SQLiteProviderProps } from "expo-sqlite";
import type { ComponentType } from "react";

/** Defines the boot target value shape. */
export type BootTarget = Href;

/** Defines the data contract for boot state. */
export interface BootState {
  initialized: boolean;
  target: BootTarget | null;
}

/** Defines the data contract for use db bootstrap result. */
export interface UseDbBootstrapResult {
  bootState: BootState;
  databaseName: string;
  handleDatabaseInit: (rawDb: SQLiteDatabase) => Promise<void>;
  sqliteOptions: { enableChangeListener: boolean };
  sqliteProvider: ComponentType<SQLiteProviderProps> | null;
}
