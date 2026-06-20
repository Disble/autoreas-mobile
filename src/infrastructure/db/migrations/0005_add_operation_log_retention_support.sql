ALTER TABLE `sync_runtime_status` ADD `is_cycle_active` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_backlog_read_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_runtime_status` ADD `last_pruned_operations_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `operation_log_status_created_at_idx` ON `operation_log` (`status`,`created_at`,`id`);
