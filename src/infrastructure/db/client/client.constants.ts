import type { MissingColumnDefinition } from './client.types';

/** Names the SQLite database opened by the application. */
export const DATABASE_NAME = 'autoreas.db';

/** Serializes write tasks independently for each SQLite connection. */
export const WRITE_QUEUE_BY_DATABASE = new WeakMap<object, Promise<unknown>>();

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
];
