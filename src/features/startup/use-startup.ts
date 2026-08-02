import { useCallback, useMemo, useRef, useState } from 'react';
import { DATABASE_NAME } from '../../infrastructure/db/client/client.constants';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { getSQLiteProvider } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { prepareForegroundDatabase } from '../../infrastructure/db/startup/startup.helpers';
import {
  STARTUP_CONFIG_FAILURE_MESSAGE,
  STARTUP_DATABASE_FAILURE_MESSAGE,
  STARTUP_FAILURE_LOG_PREFIX,
  STARTUP_FAILURE_RECOVERY_HINT,
} from './startup.constants';
import { createStartupDiagnostic } from './startup.helpers';
import type { StartupState, UseStartupResult } from './startup.types';

/** Coordinates bounded local application readiness before routes and runtime services mount. */
export function useStartup(): UseStartupResult {
  // 1. Refs
  const latestInitRequestIdRef = useRef(0);

  // 2. State
  const [startupState, setStartupState] = useState<StartupState>({
    failure: null,
    phase: 'preparing_database',
    target: null,
  });

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)
  const sqliteProvider = useMemo(() => getSQLiteProvider(), []);
  const sqliteOptions = useMemo(() => ({ enableChangeListener: true }), []);
  const isReady = startupState.phase === 'ready';

  // 6. Callbacks (`useCallback` calling pure helpers)
  const handleDatabaseInit = useCallback(async (rawDb: Parameters<UseStartupResult['handleDatabaseInit']>[0]) => {
    const requestId = latestInitRequestIdRef.current + 1;
    latestInitRequestIdRef.current = requestId;
    const isLatestRequest = () => latestInitRequestIdRef.current === requestId;

    try {
      await prepareForegroundDatabase(rawDb);
    } catch (error) {
      const diagnostic = createStartupDiagnostic('database_preparation', error);
      console.error(STARTUP_FAILURE_LOG_PREFIX, diagnostic);

      if (isLatestRequest()) {
        setStartupState({
          failure: {
            diagnostic,
            diagnosticMessage: STARTUP_DATABASE_FAILURE_MESSAGE,
            recoveryHint: STARTUP_FAILURE_RECOVERY_HINT,
          },
          phase: 'fatal',
          target: null,
        });
      }

      return;
    }

    if (isLatestRequest()) {
      setStartupState({ failure: null, phase: 'loading_config', target: null });
    }

    try {
      const bridgeConfig = await getBridgeConfigSnapshot(rawDb);

      if (isLatestRequest()) {
        setStartupState({
          failure: null,
          phase: 'ready',
          target: bridgeConfig?.deviceId ? '/(tabs)' : '/setup',
        });
      }
    } catch (error) {
      const diagnostic = createStartupDiagnostic('local_config', error);
      console.error(STARTUP_FAILURE_LOG_PREFIX, diagnostic);

      if (isLatestRequest()) {
        setStartupState({
          failure: {
            diagnostic,
            diagnosticMessage: STARTUP_CONFIG_FAILURE_MESSAGE,
            recoveryHint: STARTUP_FAILURE_RECOVERY_HINT,
          },
          phase: 'fatal',
          target: null,
        });
      }
    }
  }, []);

  // 7. Effects

  return {
    databaseName: DATABASE_NAME,
    handleDatabaseInit,
    isReady,
    sqliteOptions,
    sqliteProvider,
    startupState,
  };
}
