import {
  STARTUP_CONFIG_FAILURE_MESSAGE,
  STARTUP_DATABASE_FAILURE_MESSAGE,
  STARTUP_FAILURE_LOG_PREFIX,
  STARTUP_FAILURE_RECOVERY_HINT,
  STARTUP_LOCAL_OPERATION_DEADLINE_MS,
  STARTUP_SQLITE_CODES,
} from './startup.constants';
import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { prepareForegroundDatabase } from '../../infrastructure/db/startup/startup.helpers';
import type {
  CreateStartupDatabaseInitializerParams,
  StartupDiagnostic,
  StartupDiagnosticStage,
  StartupFailureClassification,
  UseStartupResult,
} from './startup.types';

/**
 * Reduces an arbitrary native failure to a fixed startup stage and whitelisted SQLite result code.
 * Raw messages, SQL, values, connection details, causes, and stack traces never cross this boundary.
 */
export function createStartupDiagnostic(
  stage: StartupDiagnosticStage,
  error: unknown,
): StartupDiagnostic {
  const nativeCode =
    error && typeof error === 'object' && 'code' in error
      ? Reflect.get(error, 'code')
      : undefined;
  const message = error instanceof Error ? error.message : '';
  const code = STARTUP_SQLITE_CODES.find(
    (candidate) => nativeCode === candidate || message.includes(candidate),
  ) ?? null;
  let classification: StartupFailureClassification = 'unknown';

  if (error instanceof Error && error.name === 'SchemaValidationError') {
    classification = 'schema_validation';
  } else if (error instanceof Error && error.name === 'SchemaIncompatibleError') {
    classification = 'incompatible_schema';
  } else if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    classification = 'busy';
  } else if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') {
    classification = 'corruption';
  } else if (code === 'SQLITE_SCHEMA') {
    classification = 'incompatible_schema';
  } else if (code) {
    classification = 'sqlite';
  }

  return { stage, code, classification };
}

/**
 * Rejects local startup work that does not settle before its deadline so controlled failure UI can render.
 * The timer is always cleared after settlement to prevent a completed operation from retaining resources.
 */
export function withStartupDeadline<Value>(operation: Promise<Value>, deadlineMs: number): Promise<Value> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Startup operation deadline exceeded'));
    }, deadlineMs);
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

/**
 * Creates the stable SQLiteProvider initializer that serializes local readiness and ignores superseded requests.
 * Keeping it outside the hook preserves the provider's callback identity without manual React memoization.
 */
export function createStartupDatabaseInitializer(
  params: Readonly<CreateStartupDatabaseInitializerParams>,
): UseStartupResult['handleDatabaseInit'] {
  let latestInitRequestId = 0;

  return async function handleDatabaseInit(rawDb) {
    const requestId = latestInitRequestId + 1;
    latestInitRequestId = requestId;
    const isLatestRequest = () => latestInitRequestId === requestId;

    try {
      await withStartupDeadline(
        prepareForegroundDatabase(rawDb),
        STARTUP_LOCAL_OPERATION_DEADLINE_MS,
      );
    } catch (error) {
      const diagnostic = createStartupDiagnostic('database_preparation', error);
      console.error(STARTUP_FAILURE_LOG_PREFIX, diagnostic);

      if (isLatestRequest()) {
        params.setStartupState({
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
      params.setStartupState({ failure: null, phase: 'loading_config', target: null });
    }

    try {
      const bridgeConfig = await withStartupDeadline(
        getBridgeConfigSnapshot(rawDb),
        STARTUP_LOCAL_OPERATION_DEADLINE_MS,
      );

      if (isLatestRequest()) {
        params.setStartupState({
          failure: null,
          phase: 'ready',
          target: bridgeConfig?.deviceId ? '/(tabs)' : '/setup',
        });
      }
    } catch (error) {
      const diagnostic = createStartupDiagnostic('local_config', error);
      console.error(STARTUP_FAILURE_LOG_PREFIX, diagnostic);

      if (isLatestRequest()) {
        params.setStartupState({
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
  };
}
