import {
  STARTUP_CONFIG_FAILURE_MESSAGE,
  STARTUP_DATABASE_FAILURE_MESSAGE,
  STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS,
  STARTUP_FAILURE_LOG_PREFIX,
  STARTUP_FAILURE_RECOVERY_HINT,
  STARTUP_LOCAL_OPERATION_DEADLINE_MS,
  STARTUP_SQLITE_CODES,
} from './startup.constants';
import { SQLITE_BUSY_TIMEOUT_MS } from '../../infrastructure/db/startup/startup.constants';
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
 * Decides whether a failed database preparation attempt may be retried inside the remaining startup budget.
 * Only the transient lock outcomes are retried: `classification === 'busy'`, which covers `SQLITE_BUSY`
 * and `SQLITE_LOCKED`, the two results a concurrent writer can clear on its own.
 * `corruption`, `incompatible_schema`, `schema_validation`, and `sqlite` are permanent or
 * unclassified SQLite outcomes and are never retried. `unknown` is deliberately NOT treated as
 * permanent, but it is not retried either: spending the remaining startup budget waiting on an
 * unidentified error is a guess, not a policy.
 */
export function isRetryableStartupDiagnostic(diagnostic: StartupDiagnostic): boolean {
  return diagnostic.classification === 'busy';
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
    // One shared budget for the whole local readiness sequence: database preparation (including
    // its bounded retries) and then the local configuration read each run on what remains of
    // this absolute deadline, so their combined worst case stays inside
    // STARTUP_PROVIDER_READINESS_DEADLINE_MS instead of stacking two full allowances.
    const localReadinessDeadlineAt = Date.now() + STARTUP_LOCAL_OPERATION_DEADLINE_MS;
    const prepareWithBoundedRetry = async () => {
      for (
        let attempt = 1;
        attempt <= STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS;
        attempt += 1
      ) {
        try {
          // Sequential by design: every attempt contends for the same SQLite write lock on a
          // single database connection, so running attempts concurrently would create exactly
          // the second writer on one database file this loop exists to prevent.
          await prepareForegroundDatabase(rawDb);
          return;
        } catch (error) {
          const diagnostic = createStartupDiagnostic('database_preparation', error);
          const isLastAttempt = attempt === STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS;
          // Strict comparison on the shared budget: one full busy wait must fit inside the
          // remaining local readiness allowance with room to spare, so a retry can never race
          // the outer deadline and swap the accurate `busy` diagnostic for the generic
          // deadline `unknown` classification. A superseded request never retries either: its
          // state writes are already ignored, so burning budget on its behalf is pure waste.
          const hasBudgetForAnotherBusyWait =
            Date.now() + SQLITE_BUSY_TIMEOUT_MS < localReadinessDeadlineAt;

          if (
            isLastAttempt ||
            !isLatestRequest() ||
            !isRetryableStartupDiagnostic(diagnostic) ||
            !hasBudgetForAnotherBusyWait
          ) {
            throw error;
          }
        }
      }
    };

    try {
      await withStartupDeadline(
        prepareWithBoundedRetry(),
        localReadinessDeadlineAt - Date.now(),
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
        localReadinessDeadlineAt - Date.now(),
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
