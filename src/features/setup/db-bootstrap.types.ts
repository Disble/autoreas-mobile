import type { Href } from "expo-router";
import type { SQLiteDatabase, SQLiteProviderProps } from "expo-sqlite";
import type { ComponentType } from "react";

export type BootTarget = Href;

export interface BootState {
  initialized: boolean;
  target: BootTarget | null;
}

export interface UseDbBootstrapResult {
  bootState: BootState;
  databaseName: string;
  handleDatabaseInit: (rawDb: SQLiteDatabase) => Promise<void>;
  sqliteOptions: { enableChangeListener: boolean };
  sqliteProvider: ComponentType<SQLiteProviderProps> | null;
}
