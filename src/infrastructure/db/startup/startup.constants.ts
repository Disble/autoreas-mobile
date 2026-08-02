/** Version proving that foreground startup completed every schema preparation stage. */
export const EXPECTED_SCHEMA_READINESS_VERSION = 1;

/** Maximum time an isolated connection waits for a transient SQLite writer. */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

/** Required application tables whose presence proves the current repair set completed. */
export const REQUIRED_SCHEMA_TABLES = [
  'active_season_cache',
  'animes',
  'bridge_config',
  'operation_log',
  'pending_remote_changes',
  'season_rating_queue',
  'sync_runtime_status',
  'sync_cycle_lock',
] as const;

/** Creates the durable advisory-lock table during foreground schema preparation. */
export const SYNC_CYCLE_LOCK_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS sync_cycle_lock (' +
  'id INTEGER PRIMARY KEY, ' +
  'owner TEXT NOT NULL, ' +
  'expires_at INTEGER NOT NULL)';

/** Counts required tables without exposing runtime values or application data. */
export const REQUIRED_SCHEMA_TABLE_COUNT_SQL = [
  'SELECT COUNT(*) AS count FROM sqlite_master',
  "WHERE type = 'table'",
  `AND name IN (${REQUIRED_SCHEMA_TABLES.map(() => '?').join(', ')})`,
].join(' ');
