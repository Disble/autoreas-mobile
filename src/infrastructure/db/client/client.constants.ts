import migrationJournal from '../migrations/meta/_journal.json';
import type { MissingColumnDefinition } from './client.types';

/** Names the SQLite database opened by the application. */
export const DATABASE_NAME = 'autoreas.db';

/**
 * Matches the "Error code <X>: " prefix both platforms' native bindings produce ahead of the
 * SQLite message. Android renders `<X>` as a single raw control byte (`int` -> `char` narrowing,
 * `NativeDatabaseBinding.cpp:194-202`); iOS renders it as a decimal string
 * (`SQLiteModule.swift:479`). Only the raw-byte shape is parsed -- see `parseSqliteErrcode`.
 */
export const ERRCODE_PREFIX_PATTERN = /Error code (.+?): /;

/**
 * Serializes write tasks by database FILE identity, not connection object identity, so every
 * connection opened against the same file (foreground, sync, headless) queues behind the same
 * door instead of racing each other into `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT`.
 */
export const WRITE_QUEUE_BY_DATABASE = new Map<string, Promise<unknown>>();

/**
 * Lists the kept sync-runtime columns added after the table first shipped, and their idempotent
 * repair statements. The columns migration `0020` drops are deliberately absent: re-adding them
 * here would undo the drop on every startup.
 */
export const SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS: readonly MissingColumnDefinition[] = [
  {
    columnName: 'execution_mode',
    sql: "ALTER TABLE sync_runtime_status ADD COLUMN execution_mode TEXT DEFAULT 'best_effort_background_task' NOT NULL",
  },
  {
    columnName: 'can_show_persistent_notification',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN can_show_persistent_notification INTEGER DEFAULT 0 NOT NULL',
  },
  {
    columnName: 'last_cycle_id',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_id TEXT',
  },
  {
    columnName: 'last_cycle_stage',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_stage TEXT',
  },
  {
    columnName: 'last_error_name',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_error_name TEXT',
  },
];

/**
 * Lists the `bridge_config` columns added after the table first shipped, mirroring
 * `SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS` for the one legacy repair `bridge_config` needs.
 * SQLite has no boolean literal in a column default, so `1`/`0` stand in for `true`/`false`.
 */
export const BRIDGE_CONFIG_COLUMN_DEFINITIONS: readonly MissingColumnDefinition[] = [
  {
    columnName: 'is_sync_telemetry_enabled',
    sql: 'ALTER TABLE bridge_config ADD COLUMN is_sync_telemetry_enabled INTEGER DEFAULT 1 NOT NULL',
  },
  {
    columnName: 'season_mode',
    sql: 'ALTER TABLE bridge_config ADD COLUMN season_mode INTEGER DEFAULT 0 NOT NULL',
  },
];

/**
 * Lists the `animes` columns added after the table first shipped, mirroring
 * `BRIDGE_CONFIG_COLUMN_DEFINITIONS`. Every column is intentionally nullable with no default and
 * no backfill: NULL carries its own meaning for each ("older than any remote change" for the
 * staleness guard, "no bridge token known yet" for the OCC token, "no durations known" for
 * `episodes`, "no bridge path" for `folder_relative`, "not a season candidate" for `season`, all
 * filled by the next foreground resync), so every pre-existing row must
 * read back NULL, never a fabricated value that could be mistaken for a real one.
 */
export const ANIMES_COLUMN_DEFINITIONS: readonly MissingColumnDefinition[] = [
  {
    columnName: 'last_applied_change_ms',
    sql: 'ALTER TABLE animes ADD COLUMN last_applied_change_ms INTEGER',
  },
  {
    columnName: 'bridge_modified_at',
    sql: 'ALTER TABLE animes ADD COLUMN bridge_modified_at INTEGER',
  },
  {
    columnName: 'episodes',
    sql: 'ALTER TABLE animes ADD COLUMN episodes TEXT',
  },
  {
    columnName: 'folder_relative',
    sql: 'ALTER TABLE animes ADD COLUMN folder_relative TEXT',
  },
  {
    columnName: 'season',
    sql: 'ALTER TABLE animes ADD COLUMN season TEXT',
  },
];

/**
 * Lists the `app_preferences` columns added after the table first shipped. The table exists only
 * as a repair step, so `CREATE TABLE IF NOT EXISTS` is a no-op on an installed device and this list
 * is the only route for these columns there. Both are nullable with no default: NULL means "no
 * anime root chosen" and "hint never dismissed", the state of every device before the feature.
 */
export const APP_PREFERENCES_COLUMN_DEFINITIONS: readonly MissingColumnDefinition[] = [
  {
    columnName: 'anime_folders_root_uri',
    sql: 'ALTER TABLE app_preferences ADD COLUMN anime_folders_root_uri TEXT',
  },
  {
    columnName: 'anime_folders_hint_dismissed_at',
    sql: 'ALTER TABLE app_preferences ADD COLUMN anime_folders_hint_dismissed_at INTEGER',
  },
];

/**
 * Lists the `operation_log` columns added after the table first shipped, mirroring
 * `ANIMES_COLUMN_DEFINITIONS`. Unlike those two, `conflict_attempt_count` is NOT NULL with a
 * default of 0: it is a per-row client-authored fact (design.md Decision 6), not a bridge token,
 * so every pre-existing queued row can safely read back "zero conflicts so far" rather than an
 * unknown value.
 */
export const OPERATION_LOG_COLUMN_DEFINITIONS: readonly MissingColumnDefinition[] = [
  {
    columnName: 'conflict_attempt_count',
    sql: 'ALTER TABLE operation_log ADD COLUMN conflict_attempt_count INTEGER DEFAULT 0 NOT NULL',
  },
  // ADR 009 R-13 per-key claim: NULL means unclaimed. Repair twin of migration 0018.
  { columnName: 'claim_owner', sql: 'ALTER TABLE operation_log ADD COLUMN claim_owner TEXT' },
  { columnName: 'claimed_at', sql: 'ALTER TABLE operation_log ADD COLUMN claimed_at INTEGER' },
  // ADR 009 R-16(b): why a row with no dedicated status was given up. NULL on every other row.
  { columnName: 'unresolved_reason', sql: 'ALTER TABLE operation_log ADD COLUMN unresolved_reason TEXT' },
];

/**
 * Lists the `sync_cycle_lock` columns added after the table first shipped, mirroring
 * `ANIMES_COLUMN_DEFINITIONS` for the advisory-lock table's one legacy repair.
 *
 * `fence` is the per-claim token a reclaimed lease checks before honoring an owner's writes
 * (ADR 008's fencing invariant). It is deliberately NULLABLE with no default: a fabricated
 * token on pre-existing rows would look like a claim the row never recorded, while NULL means
 * "claimed by code that predates fencing" -- such a row is only reclaimable through its lease
 * expiry, exactly as before, and the first fenced claimant overwrites the token wholesale.
 */
export const SYNC_CYCLE_LOCK_COLUMN_DEFINITIONS: readonly MissingColumnDefinition[] = [
  {
    columnName: 'fence',
    sql: 'ALTER TABLE sync_cycle_lock ADD COLUMN fence TEXT',
  },
];

/**
 * The newest `when` any journal entry carries, and therefore the highest `created_at` the
 * migrator could ever write. Used as the pin for an installed device's ledger so drizzle's gate
 * reports "everything applied" and the migrator becomes a fresh-install bootstrapper only.
 */
export const MAX_JOURNAL_MIGRATION_TIMESTAMP_MS = Math.max(
  ...migrationJournal.entries.map((entry) => entry.when),
);

/**
 * Proves the application schema already exists. `animes` ships in migration `0000`, so its
 * presence is the one reliable "this is not a fresh install" signal -- far more reliable than the
 * ledger, whose rows carry an empty `hash` and cannot say WHICH migrations they record.
 */
export const MIGRATION_BOOTSTRAP_TABLE_LOOKUP_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'animes'";

/**
 * The migrator's own ledger DDL, duplicated verbatim from `drizzle-orm/sqlite-core/dialect.cjs`
 * so an installed device missing the table can be given a gate before `migrate()` reads one.
 */
export const MIGRATION_LEDGER_CREATE_SQL =
  'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)';

/** Counts ledger rows, to tell a pinnable ledger from an empty one that must be seeded. */
export const MIGRATION_LEDGER_COUNT_SQL =
  'SELECT COUNT(*) AS count FROM __drizzle_migrations';

/** Seeds a gate row on an installed device whose ledger holds nothing to pin. */
export const MIGRATION_LEDGER_SEED_SQL =
  'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES(?, ?)';

/** Pins every ledger row to the journal maximum, skipping rows already there. */
export const MIGRATION_LEDGER_PIN_SQL =
  'UPDATE __drizzle_migrations SET created_at = ? WHERE created_at <> ?';

/**
 * Budget for one queued local write, measured from the moment it is QUEUED rather than from the
 * moment its transaction begins -- a caller stuck behind a jammed door should see the wait it
 * actually experienced. On expiry the caller is rejected and the door STAYS CLOSED; see
 * `withQueuedWrite`. Sits above the bridge request budget and below the cycle deadline so a
 * jammed door is attributed to the write layer rather than to the cycle.
 */
export const LOCAL_WRITE_DEADLINE_MS = 20_000;

/** Creates the remote-change staging table the background engine writes and the foreground drains. */
export const PENDING_REMOTE_CHANGES_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS pending_remote_changes (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
  'record_id TEXT NOT NULL, ' +
  'change_type TEXT NOT NULL, ' +
  'changed_fields TEXT NOT NULL, ' +
  'snapshot TEXT, ' +
  'timestamp INTEGER NOT NULL, ' +
  'created_at INTEGER NOT NULL)';

/** Creates the single-row active-season cache. Exists in no migration file; only as a repair step. */
export const ACTIVE_SEASON_CACHE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS active_season_cache (' +
  'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
  'season_id TEXT NOT NULL, ' +
  'candidates_json TEXT NOT NULL)';
