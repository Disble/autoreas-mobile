import {
  STARTUP_CONFIG_FAILURE_MESSAGE,
  STARTUP_ERROR_CODE_CLASSIFICATIONS,
  STARTUP_ERROR_NAME_CLASSIFICATIONS,
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
  UseStartupResult,
} from './startup.types';





/**
 * Reads a raw `code` property off an arbitrary failure without trusting its shape or value.
 * Only property presence is checked; membership filtering happens against the whitelist.
 */
function readNativeErrorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

/**
 * Extracts the first whitelisted SQLite result code carried by a failure, from its raw `code`
 * property or its message, or `null` when the failure carries none. Raw messages, SQL, values,
 * connection details, causes, and stack traces never cross this boundary.
 */
function readWhitelistedSqliteCode(error: unknown): string | null {
  const nativeCode = readNativeErrorCode(error);
  const message = error instanceof Error ? error.message : '';

  return (
    STARTUP_SQLITE_CODES.find(
      (candidate) => nativeCode === candidate || message.includes(candidate),
    ) ?? null
  );
}

/**
 * Reduces an arbitrary native failure to a fixed startup stage and whitelisted SQLite result code.
 * Raw messages, SQL, values, connection details, causes, and stack traces never cross this boundary.
 *
 * Classification walks two ordered rule tables in one pass: the error-name rules first, then the
 * error-code rules, defaulting to `unknown` (no code) or `sqlite` (an unclassified whitelisted
 * code). The name rules stay ahead of the code rules on purpose: `SchemaIntegrityError` means
 * SQLite's own integrity check rejected the file, which is reported as `corruption` and is the
 * only condition that may authorize a reset; `SchemaValidationError` means a table or column is
 * missing, which is a repairable logical mismatch and must never be reported as damage.
 */
export function createStartupDiagnostic(
  stage: StartupDiagnosticStage,
  error: unknown,
): StartupDiagnostic {
  const code = readWhitelistedSqliteCode(error);
  const errorName = error instanceof Error ? error.name : null;
  const nameRule = STARTUP_ERROR_NAME_CLASSIFICATIONS.find(([name]) => name === errorName);
  const codeRule =
    code !== null
      ? STARTUP_ERROR_CODE_CLASSIFICATIONS.find(([codes]) => codes.includes(code))
      : undefined;

  return {
    stage,
    code,
    classification: nameRule?.[1] ?? codeRule?.[1] ?? (code === null ? 'unknown' : 'sqlite'),
  };
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
    // Capture the provider's live connection before anything else. A reset needs a handle to close
    // whether or not preparation succeeds, and this callback is the only moment the composition
    // ever sees it -- the recovery card renders outside the provider, so the optional context is
    // null exactly when the reset runs.
    params.onDatabaseOpened?.(rawDb);

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
