CREATE TABLE `status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL,
	`card_title` text NOT NULL,
	`from_column_id` text,
	`to_column_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`from_column_index` integer,
	`to_column_index` integer NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`moved_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_status_history_card_moved_at` ON `status_history` (`card_id`,`moved_at`);--> statement-breakpoint
CREATE INDEX `idx_status_history_moved_at` ON `status_history` (`moved_at`);