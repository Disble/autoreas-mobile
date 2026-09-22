import { useEffect, useRef } from 'react';
import { STARTUP_FAILURE_LOG_PREFIX } from '../../startup.constants';
import type { StartupDiagnosticStage, StartupFailure } from '../../startup.types';

/** Defines the hook-created terminal failures that need one-shot logging. */
export interface UseStartupFailureLogsParams {
  readonly failures: readonly (StartupFailure | null)[];
}

/**
 * Logs each hook-created terminal startup failure once per distinct diagnostic stage.
 *
 * The hook logs only the terminal failures the boundary itself creates: `startup.helpers.ts`
 * already logs the database_preparation and local_config diagnostics it builds, so a second log
 * for those stages must never appear here. The lazily created ref Set keeps React re-renders and
 * StrictMode double-invocation from duplicating a log.
 */
export function useStartupFailureLogs(params: Readonly<UseStartupFailureLogsParams>): void {
  const { failures } = params;
  const loggedFailureStagesRef = useRef<Set<StartupDiagnosticStage> | null>(null);

  useEffect(() => {
    if (loggedFailureStagesRef.current === null) {
      loggedFailureStagesRef.current = new Set<StartupDiagnosticStage>();
    }

    const loggedFailureStages = loggedFailureStagesRef.current;
    for (const hookFailure of failures) {
      if (!hookFailure || loggedFailureStages.has(hookFailure.diagnostic.stage)) {
        continue;
      }

      loggedFailureStages.add(hookFailure.diagnostic.stage);
      console.error(STARTUP_FAILURE_LOG_PREFIX, hookFailure.diagnostic);
    }
  }, [failures]);
}
