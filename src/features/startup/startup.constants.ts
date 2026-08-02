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

/** Maximum time local readiness work may retain the native startup splash. */
export const STARTUP_LOCAL_OPERATION_DEADLINE_MS = 5_000;

/** SQLiteProvider configuration is immutable and shared across every startup render. */
export const STARTUP_SQLITE_OPTIONS = { enableChangeListener: true } as const;

/** Maximum time font loading may retain the native startup splash. */
export const STARTUP_FONT_LOAD_DEADLINE_MS = 5_000;

/** Maximum time SQLiteProvider may retain Suspense before local startup enters a controlled failure. */
export const STARTUP_PROVIDER_READINESS_DEADLINE_MS = 5_000;

/** Safe Spanish diagnostic shown when required application fonts cannot load. */
export const STARTUP_FONT_FAILURE_MESSAGE =
  'No se pudieron cargar los recursos visuales durante el inicio.';

/** Safe Spanish diagnostic shown when SQLiteProvider never reaches its local initialization callback. */
export const STARTUP_PROVIDER_READINESS_FAILURE_MESSAGE =
  'No se pudo preparar la base local durante el inicio.';
