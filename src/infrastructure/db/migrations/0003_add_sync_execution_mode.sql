ALTER TABLE `sync_runtime_status` ADD COLUMN `execution_mode` text DEFAULT 'best_effort_background_task' NOT NULL;
ALTER TABLE `sync_runtime_status` ADD COLUMN `is_foreground_service_running` integer DEFAULT 0 NOT NULL;
ALTER TABLE `sync_runtime_status` ADD COLUMN `can_show_persistent_notification` integer DEFAULT 0 NOT NULL;
