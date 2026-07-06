CREATE TABLE `season_rating_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` text NOT NULL,
	`anime_id` text NOT NULL,
	`nota` integer NOT NULL,
	`rated_at` integer NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_attempt_at` integer,
	`last_failure_kind` text
);

CREATE INDEX `season_rating_queue_status_created_at_idx`
	ON `season_rating_queue` (`status`,`created_at`,`id`);
