-- Convergent sync T18 (S14, L31-L32): `sync_runtime_status` keeps only the columns something still
-- reads -- registration, execution mode, notification capability, the attempt and success instants,
-- and the last cycle's id, stage and error name. Every other column lost its last reader when the
-- JS cycle post-mortem and its never-closed signal were removed, so they are dropped here.
--
-- Hand-written, following 0011-0019: this repository's `meta/` snapshot chain is stale.
--
-- This file drops exactly the 23 dead columns a fresh install's migration chain creates. Four more
-- (`is_foreground_service_running`, `last_no_op_reason`, `last_pending_operations_count_at_start`
-- and `is_background_task_registered`) were only ever created by repair steps -- the first three sit
-- in the discarded tail of a packed 0003/0004 chunk -- so a fresh install never has them, and a DROP
-- here would abort its startup with "no such column".
--
-- BOTH routes are required. An already provisioned device never runs this file
-- (`reconcileMigrationLedger` pins the gate): it reaches the same end state through the repair
-- step `dropDeadSyncRuntimeStatusColumns`, which drops every one of the 27 dead columns it finds
-- in one exclusive transaction. SQLite >= 3.35 is required for DROP COLUMN; expo-sqlite bundles a
-- newer one.

ALTER TABLE `sync_runtime_status` DROP COLUMN `last_failure_message`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_trigger_source`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_synced_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `foreground_service_callback_started_at`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `is_cycle_active`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_backlog_read_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_pruned_operations_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_native_errcode_byte`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_error_stage`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `consecutive_unclosed_cycles`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_cycle_stage_at`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_failed_checkpoint_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_diagnostics_discarded_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_diagnostics_undeliverable_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_diagnostics_unclassified_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_diagnostics_reaped_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_diagnostics_failed_removal_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_outbox_failed_write_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_dead_letter_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_conflict_exhausted_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_stuck_processing_count`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_oldest_pending_age_ms`;
--> statement-breakpoint
ALTER TABLE `sync_runtime_status` DROP COLUMN `last_pending_row_count`;
