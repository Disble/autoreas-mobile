ALTER TABLE `sync_runtime_status` ADD COLUMN `foreground_service_callback_started_at` integer;
ALTER TABLE `sync_runtime_status` ADD COLUMN `last_no_op_reason` text;
ALTER TABLE `sync_runtime_status` ADD COLUMN `last_pending_operations_count_at_start` integer;
