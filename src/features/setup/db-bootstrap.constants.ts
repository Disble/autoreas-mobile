/** Provides the safe diagnostic shown when local startup migrations fail. */
export const DB_BOOTSTRAP_MIGRATIONS_FAILURE_MESSAGE =
  'Error al preparar la base local durante el inicio.';

/** Provides the safe diagnostic shown when the local bridge snapshot cannot be read. */
export const DB_BOOTSTRAP_BRIDGE_CONFIG_FAILURE_MESSAGE =
  'Error al leer la configuración local durante el inicio.';

/** Provides the recovery hint shown after a startup bootstrap failure. */
export const DB_BOOTSTRAP_FAILURE_RECOVERY_HINT =
  'Cerrá y volvé a abrir la app. Si vuelve a pasar, avisá que falló el inicio local.';

/** Provides the shared log prefix for startup bootstrap failures. */
export const DB_BOOTSTRAP_FAILURE_LOG_PREFIX = '[db-bootstrap] Startup bootstrap failed:';
