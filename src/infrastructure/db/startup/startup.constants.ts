import migrationJournal from '../migrations/meta/_journal.json';

/**
 * Version proving that foreground startup completed every schema preparation stage.
 *
 * DERIVED from the migration journal, and that is the entire point. This value used to be a
 * literal `1`, which turned the readiness check into a one-shot gate: once a device recorded
 * `user_version = 1`, `prepareForegroundDatabase` short-circuited before `runMigrations` and
 * EVERY migration added afterwards was skipped in silence. The app then ran new code against an
 * old table and failed on the first write to a column that was never created.
 *
 * Tying it to `journal.entries.length` makes the bump automatic: adding a migration raises the
 * expected version, an installed device reads a lower one, and the migrator runs. It also makes
 * the mistake unrepeatable by construction rather than by remembering.
 */
export const EXPECTED_SCHEMA_READINESS_VERSION = migrationJournal.entries.length;

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

/**
 * Maps each table needing column-level readiness proof to its required column names. A table
 * existing in `sqlite_master` proves nothing about which columns a silently skipped migration
 * (H0Xx: a poisoned journal `when` gate) would have added -- this is what makes a skipped
 * migration visible instead of letting `validatePreparedSchema` stamp readiness over it.
 */
export const REQUIRED_SCHEMA_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  sync_runtime_status: ['last_cycle_id'],
  bridge_config: ['is_sync_telemetry_enabled'],
  animes: ['last_applied_change_ms', 'bridge_modified_at'],
};

/** Counts required tables without exposing runtime values or application data. */
export const REQUIRED_SCHEMA_TABLE_COUNT_SQL = [
  'SELECT COUNT(*) AS count FROM sqlite_master',
  "WHERE type = 'table'",
  `AND name IN (${REQUIRED_SCHEMA_TABLES.map(() => '?').join(', ')})`,
].join(' ');
