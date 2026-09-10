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

/** Lists legacy sync-runtime columns and their idempotent repair statements. */
export const SYNC_RUNTIME_STATUS_COLUMN_DEFINITIONS: readonly MissingColumnDefinition[] = [
  {
    columnName: 'execution_mode',
    sql: "ALTER TABLE sync_runtime_status ADD COLUMN execution_mode TEXT DEFAULT 'best_effort_background_task' NOT NULL",
  },
  {
    columnName: 'is_foreground_service_running',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN is_foreground_service_running INTEGER DEFAULT 0 NOT NULL',
  },
  {
    columnName: 'can_show_persistent_notification',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN can_show_persistent_notification INTEGER DEFAULT 0 NOT NULL',
  },
  {
    columnName: 'foreground_service_callback_started_at',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN foreground_service_callback_started_at INTEGER',
  },
  {
    columnName: 'last_no_op_reason',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_no_op_reason TEXT',
  },
  {
    columnName: 'last_pending_operations_count_at_start',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_pending_operations_count_at_start INTEGER',
  },
  {
    columnName: 'is_cycle_active',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN is_cycle_active INTEGER DEFAULT 0 NOT NULL',
  },
  {
    columnName: 'last_backlog_read_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_backlog_read_count INTEGER DEFAULT 0 NOT NULL',
  },
  {
    columnName: 'last_pruned_operations_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_pruned_operations_count INTEGER DEFAULT 0 NOT NULL',
  },
  {
    columnName: 'is_background_task_registered',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN is_background_task_registered INTEGER DEFAULT 0 NOT NULL',
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
  {
    columnName: 'last_native_errcode_byte',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_native_errcode_byte INTEGER',
  },
  {
    columnName: 'last_error_stage',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_error_stage TEXT',
  },
  {
    columnName: 'consecutive_unclosed_cycles',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN consecutive_unclosed_cycles INTEGER DEFAULT 0 NOT NULL',
  },
  {
    columnName: 'last_cycle_stage_at',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_cycle_stage_at INTEGER',
  },
  {
    columnName: 'last_failed_checkpoint_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_failed_checkpoint_count INTEGER DEFAULT 0 NOT NULL',
  },
  // Convergence-instrumentation columns (design.md `2026-09-09-convergence-instrumentation`
  // Decision 6). Nullable with no default, mirroring `last_cycle_id`/`last_error_name` above:
  // NULL means "never measured", not zero (Decision 7).
  {
    columnName: 'last_diagnostics_discarded_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_diagnostics_discarded_count INTEGER',
  },
  {
    columnName: 'last_diagnostics_failed_removal_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_diagnostics_failed_removal_count INTEGER',
  },
  {
    columnName: 'last_outbox_failed_write_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_outbox_failed_write_count INTEGER',
  },
  {
    columnName: 'last_dead_letter_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_dead_letter_count INTEGER',
  },
  {
    columnName: 'last_conflict_exhausted_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_conflict_exhausted_count INTEGER',
  },
  {
    columnName: 'last_stuck_processing_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_stuck_processing_count INTEGER',
  },
  {
    columnName: 'last_oldest_pending_age_ms',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_oldest_pending_age_ms INTEGER',
  },
  {
    columnName: 'last_pending_row_count',
    sql: 'ALTER TABLE sync_runtime_status ADD COLUMN last_pending_row_count INTEGER',
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
];

/**
 * Lists the `animes` columns added after the table first shipped, mirroring
 * `BRIDGE_CONFIG_COLUMN_DEFINITIONS`. Both columns are intentionally nullable with no default and
 * no backfill: NULL carries its own meaning for each ("older than any remote change" for the
 * staleness guard, "no bridge token known yet" for the OCC token), so every pre-existing row must
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
