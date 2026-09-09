-- Convergence-instrumentation columns (2026-09-09-convergence-instrumentation, Decision 6).
--
-- Trimmed by hand from the drizzle-kit output, exactly as 0010's header documents and warns
-- every future generation will need. The generator diffed against a stale snapshot chain (this
-- repo has no `meta/0009_snapshot.json`, `0011_snapshot.json`, or `0012_snapshot.json`) and
-- re-emitted three ALTERs for columns that already exist on installed databases:
-- `animes.bridge_modified_at` (added by 0011), `operation_log.conflict_attempt_count` (added by
-- 0012), and `sync_runtime_status.last_cycle_stage_at` / `last_failed_checkpoint_count` (added
-- by 0010 itself) -- running any of those again would abort the migration with a duplicate
-- column error. This file therefore carries exactly the eight columns this change introduces
-- and nothing else. All eight are nullable with no default: NULL means "never measured", never
-- a plausible zero (design.md Decision 7).

ALTER TABLE `sync_runtime_status` ADD `last_diagnostics_discarded_count` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_diagnostics_failed_removal_count` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_outbox_failed_write_count` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_dead_letter_count` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_conflict_exhausted_count` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_stuck_processing_count` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_oldest_pending_age_ms` integer;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_pending_row_count` integer;
