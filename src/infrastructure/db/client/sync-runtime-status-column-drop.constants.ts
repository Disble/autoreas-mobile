/** Lists the columns `sync_runtime_status` holds right now. */
export const SYNC_RUNTIME_STATUS_TABLE_INFO_SQL = 'PRAGMA table_info(sync_runtime_status)';

/**
 * Every `sync_runtime_status` column convergent-sync T18 retired (S14, L31-L32): none has a reader
 * left. Migration `0020` drops the 23 a fresh install's migration chain creates; the repair step
 * drops whichever of all 27 an installed device holds, including the four only a repair step ever
 * created.
 */
export const DEAD_SYNC_RUNTIME_STATUS_COLUMNS: readonly string[] = [
  'is_foreground_service_running',
  'last_failure_message',
  'last_trigger_source',
  'last_synced_count',
  'foreground_service_callback_started_at',
  'last_no_op_reason',
  'last_pending_operations_count_at_start',
  'is_cycle_active',
  'last_backlog_read_count',
  'last_pruned_operations_count',
  'is_background_task_registered',
  'last_native_errcode_byte',
  'last_error_stage',
  'consecutive_unclosed_cycles',
  'last_cycle_stage_at',
  'last_failed_checkpoint_count',
  'last_diagnostics_discarded_count',
  'last_diagnostics_undeliverable_count',
  'last_diagnostics_unclassified_count',
  'last_diagnostics_reaped_count',
  'last_diagnostics_failed_removal_count',
  'last_outbox_failed_write_count',
  'last_dead_letter_count',
  'last_conflict_exhausted_count',
  'last_stuck_processing_count',
  'last_oldest_pending_age_ms',
  'last_pending_row_count',
];
