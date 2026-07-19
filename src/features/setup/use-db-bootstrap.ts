import type { SQLiteDatabase } from "expo-sqlite";
import { useCallback, useMemo, useRef, useState } from "react";
import { DATABASE_NAME } from "../../infrastructure/db/client/client.constants";
import {
  getBridgeConfigSnapshot,
  runMigrations,
} from "../../infrastructure/db/client/client.helpers";
import { getSQLiteProvider } from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import {
  DB_BOOTSTRAP_BRIDGE_CONFIG_FAILURE_MESSAGE,
  DB_BOOTSTRAP_FAILURE_LOG_PREFIX,
  DB_BOOTSTRAP_FAILURE_RECOVERY_HINT,
  DB_BOOTSTRAP_MIGRATIONS_FAILURE_MESSAGE,
} from "./db-bootstrap.constants";
import type { BootState, UseDbBootstrapResult } from "./db-bootstrap.types";

/** Coordinates db bootstrap state and actions. */
export function useDbBootstrap(): UseDbBootstrapResult {
  // 1. Refs
  const latestInitRequestIdRef = useRef(0);

  // 2. State
  const [bootState, setBootState] = useState<BootState>({
    failure: null,
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
    const requestId = latestInitRequestIdRef.current + 1;
    latestInitRequestIdRef.current = requestId;

    const isLatestRequest = () => latestInitRequestIdRef.current === requestId;

    try {
      await rawDb.execAsync("PRAGMA journal_mode = WAL;");
      await runMigrations(rawDb);
    } catch (error) {
      console.error(
        `${DB_BOOTSTRAP_FAILURE_LOG_PREFIX} ${DB_BOOTSTRAP_MIGRATIONS_FAILURE_MESSAGE}`,
        error,
      );

      if (isLatestRequest()) {
        setBootState({
          failure: {
            diagnosticMessage: DB_BOOTSTRAP_MIGRATIONS_FAILURE_MESSAGE,
            recoveryHint: DB_BOOTSTRAP_FAILURE_RECOVERY_HINT,
          },
          initialized: false,
          target: null,
        });
      }

      return;
    }

    try {
      const bridgeConfig = await getBridgeConfigSnapshot(rawDb);

      if (isLatestRequest()) {
        setBootState({
          failure: null,
          initialized: true,
          target: bridgeConfig?.deviceId ? "/(tabs)" : "/setup",
        });
      }
    } catch (error) {
      console.error(
        `${DB_BOOTSTRAP_FAILURE_LOG_PREFIX} ${DB_BOOTSTRAP_BRIDGE_CONFIG_FAILURE_MESSAGE}`,
        error,
      );

      if (isLatestRequest()) {
        setBootState({
          failure: {
            diagnosticMessage: DB_BOOTSTRAP_BRIDGE_CONFIG_FAILURE_MESSAGE,
            recoveryHint: DB_BOOTSTRAP_FAILURE_RECOVERY_HINT,
          },
          initialized: false,
          target: null,
        });
      }
    }
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
