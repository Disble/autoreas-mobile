import type { SQLiteDatabase } from "expo-sqlite";
import { useCallback, useMemo, useState } from "react";
import {
  DATABASE_NAME,
  getBridgeConfigSnapshot,
  runMigrations,
} from "../../infrastructure/db/client";
import { getSQLiteProvider } from "../../infrastructure/db/native-runtime";
import { initialSync } from "../sync/use-initial-sync";
import type { BootState, UseDbBootstrapResult } from "./db-bootstrap.types";

export function useDbBootstrap(): UseDbBootstrapResult {
  // 1. Refs

  // 2. State
  const [bootState, setBootState] = useState<BootState>({
    initialized: false,
    target: null,
  });

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)
  const sqliteProvider = useMemo(() => getSQLiteProvider(), []);

  const sqliteOptions = useMemo(
    () => ({ enableChangeListener: true }),
    [],
  );

  // 6. Callbacks (`useCallback` calling pure helpers)
  const handleDatabaseInit = useCallback(async (rawDb: SQLiteDatabase) => {
    await rawDb.execAsync("PRAGMA journal_mode = WAL;");
    await runMigrations(rawDb);

    const bridgeConfig = await getBridgeConfigSnapshot(rawDb);

    if (bridgeConfig?.deviceId) {
      try {
        await initialSync(rawDb);
      } catch (error) {
        console.warn("[Boot] Initial sync failed:", error);
      }
    }

    setBootState({
      initialized: true,
      target: bridgeConfig?.deviceId ? "/(tabs)" : "/setup",
    });
  }, []);

  // 7. Effects

  return {
    bootState,
    databaseName: DATABASE_NAME,
    handleDatabaseInit,
    sqliteOptions,
    sqliteProvider,
  };
}
