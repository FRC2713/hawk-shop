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
ALTER TABLE `slack_config` ADD `reports_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `slack_config` ADD `reports_channel_id` text;