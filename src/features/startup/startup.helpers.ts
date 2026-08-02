import { STARTUP_SQLITE_CODES } from './startup.constants';
import type {
  StartupDiagnostic,
  StartupDiagnosticStage,
  StartupFailureClassification,
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
