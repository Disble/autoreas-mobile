CREATE TABLE `sync_runtime_status` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`registration_status` text DEFAULT 'unregistered' NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_failure_message` text,
	`last_trigger_source` text,
	`last_synced_count` integer DEFAULT 0 NOT NULL
);
