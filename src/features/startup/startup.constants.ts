/** SQLite result codes safe to include in structured startup diagnostics. */
export const STARTUP_SQLITE_CODES = [
  'SQLITE_BUSY',
  'SQLITE_CANTOPEN',
  'SQLITE_CONSTRAINT',
  'SQLITE_CORRUPT',
  'SQLITE_ERROR',
  'SQLITE_FULL',
  'SQLITE_IOERR',
  'SQLITE_LOCKED',
  'SQLITE_NOTADB',
  'SQLITE_SCHEMA',
] as const;

/** Safe Spanish diagnostic shown when database preparation fails. */
export const STARTUP_DATABASE_FAILURE_MESSAGE =
  'Error al preparar la base local durante el inicio.';

/** Safe Spanish diagnostic shown when local configuration loading fails. */
export const STARTUP_CONFIG_FAILURE_MESSAGE =
  'Error al leer la configuración local durante el inicio.';

/** Recovery guidance retained from the existing controlled startup failure. */
export const STARTUP_FAILURE_RECOVERY_HINT =
  'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.';

/** Safe log prefix for structured startup diagnostics. */
export const STARTUP_FAILURE_LOG_PREFIX = '[startup] Local readiness failed';

/**
 * Single budget shared by the WHOLE local readiness sequence: database preparation (including its
 * bounded retries) and then the local configuration read each run on what remains of one absolute
 * deadline computed once at the start of `handleDatabaseInit`. It is a per-SEQUENCE allowance,
 * never a per-operation one, so the two stages cannot stack two full budgets and overrun it.
 * It is the HARD boundary: this is the only startup deadline whose expiry
 * is terminal for database preparation and the local configuration read.
 *
 * ORDERING RULE (enforced by `tests/features/startup/__tests__/startup-budget-ordering.test.ts`):
 * `SQLITE_BUSY_TIMEOUT_MS < STARTUP_SOFT_DEADLINE_MS < this < STARTUP_PROVIDER_READINESS_DEADLINE_MS`.
 * Because this is one shared sequence budget, `STARTUP_PROVIDER_READINESS_DEADLINE_MS` -- strictly
 * above it -- envelopes the entire local sequence and can never fire while local work is still
 * inside its own allowance.
 * This budget used to hold the SAME value as `SQLITE_BUSY_TIMEOUT_MS` (5000 each). Equal budgets
 * are not ordered budgets: the connection is authorized to spend its whole allowance waiting for
 * a lock inside an operation that is declared failed at the same instant, so a transient SQLite
 * lock wait could never resolve and was reported to the user as a fatal startup error. Keeping
 * this strictly above the busy wait -- with room for a retry -- is the fix, not a tuning choice.
 */
export const STARTUP_LOCAL_OPERATION_DEADLINE_MS = 20_000;

/**
 * Time after which local startup is considered slow, without being considered failed.
 *
 * Deliberately ABOVE `SQLITE_BUSY_TIMEOUT_MS`: one lock wait still inside its own allowance is
 * normal, so this boundary must not be reached while a single wait is legitimately in flight.
 * Reaching it changes the loading message and nothing else -- it never selects the failure card.
 */
export const STARTUP_SOFT_DEADLINE_MS = 8_000;

/**
 * Hard cap on how many times database preparation may be attempted inside one startup.
 * The budget-based retry rule can only slow the loop down, so this cap guarantees that an
 * instantly rejecting preparation can never spin: at most `STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS`
 * attempts happen before the failure becomes terminal.
 */
export const STARTUP_DATABASE_PREPARATION_MAX_ATTEMPTS = 4;

/** SQLiteProvider configuration is immutable and shared across every startup render. */
export const STARTUP_SQLITE_OPTIONS = { enableChangeListener: true } as const;

/** Maximum time font loading may retain the native startup splash. */
export const STARTUP_FONT_LOAD_DEADLINE_MS = 5_000;

/**
 * Maximum time SQLiteProvider may retain Suspense before local startup enters a controlled failure.
 *
 * This watchdog ENVELOPES the work it observes -- database preparation plus the local
 * configuration read -- so it must stay strictly above `STARTUP_LOCAL_OPERATION_DEADLINE_MS`. At
 * equal values the two timers raced, and which of the two messages the user saw (a preparation
 * failure or a provider-readiness failure) was decided by timer order rather than by the stage
 * that actually failed.
 */
export const STARTUP_PROVIDER_READINESS_DEADLINE_MS = 25_000;

/** Safe Spanish diagnostic shown when required application fonts cannot load. */
export const STARTUP_FONT_FAILURE_MESSAGE =
  'No se pudieron cargar los recursos visuales durante el inicio.';

/** Safe Spanish diagnostic shown when SQLiteProvider never reaches its local initialization callback. */
export const STARTUP_PROVIDER_READINESS_FAILURE_MESSAGE =
  'No se pudo preparar la base local durante el inicio.';
