CREATE TABLE `problem_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`delivered_at` text
);
--> statement-breakpoint
CREATE INDEX `problem_reports_member_created` ON `problem_reports` (`member_id`,`created_at`);--> statement-breakpoint
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
CREATE INDEX `idx_status_history_moved_at` ON `status_history` (`moved_at`);--> statement-breakpoint
ALTER TABLE `slack_config` ADD `reports_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `slack_config` ADD `reports_channel_id` text;