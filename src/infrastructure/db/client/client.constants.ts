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
 * Migration 0010's own `when` from `_journal.json`, duplicated here as a HARDCODED literal rather
 * than derived from the journal at runtime. This is the clamp target for
 * `clampPoisonedMigrationTimestamp`, and deriving it from `max(journal.entries[].when)` would
 * defeat the whole repair: as soon as a migration after 0010 is added, that derived maximum rises
 * to the NEW migration's timestamp, and the clamp would then poison that migration exactly the
 * way migration 0006's hand-typed future `when` (2026-09-20, `_journal.json` idx 6) poisoned
 * every migration after it on a device that had already stored the poisoned row. Holding this
 * value fixed says "everything through 0010 is applied in effect" -- true, because
 * `ensureSyncRuntimeStatusExecutionColumns` and the `bridge_config` repair above create every
 * column 0007-0010 would have created -- and lets 0011+ apply normally once they exist.
 */
export const MIGRATION_0010_TIMESTAMP_MS = 1788546067501;

/**
 * Budget for one queued local write, measured from the moment it is QUEUED rather than from the
 * moment its transaction begins -- a caller stuck behind a jammed door should see the wait it
 * actually experienced. On expiry the caller is rejected and the door STAYS CLOSED; see
 * `withQueuedWrite`. Sits above the bridge request budget and below the cycle deadline so a
 * jammed door is attributed to the write layer rather than to the cycle.
 */
export const LOCAL_WRITE_DEADLINE_MS = 20_000;
