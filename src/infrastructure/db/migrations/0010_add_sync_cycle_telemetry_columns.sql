-- Sync-cycle telemetry columns.
--
-- Trimmed by hand from the drizzle-kit output. The generator diffed against a stale 0009
-- snapshot and re-emitted CREATE TABLE for `season_rating_queue` and `active_season_cache`
-- plus an ALTER for `is_background_task_registered` -- all of which already exist on installed
-- databases, so running them would abort the migration. Those objects are maintained by the
-- idempotent `ensure*Table` / `ensureMissingColumns` repair steps in `client.helpers.ts`
-- (see its comment: `active_season_cache` and `sync_cycle_lock` exist ONLY as repair steps).
-- This file therefore carries exactly the columns this change introduces and nothing else.

ALTER TABLE `bridge_config` ADD `is_sync_telemetry_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_cycle_id` text;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_cycle_stage` text;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_error_name` text;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_native_errcode_byte` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_error_stage` text;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `consecutive_unclosed_cycles` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_cycle_stage_at` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_failed_checkpoint_count` integer DEFAULT 0 NOT NULL;
