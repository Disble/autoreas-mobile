CREATE TABLE `pending_remote_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL,
	`change_type` text NOT NULL,
	`changed_fields` text NOT NULL,
	`snapshot` text,
	`timestamp` integer NOT NULL,
	`created_at` integer NOT NULL
);
