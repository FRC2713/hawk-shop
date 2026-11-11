CREATE TABLE `slack_threads` (
	`card_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`ts` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`card_id`, `channel_id`)
);
--> statement-breakpoint
ALTER TABLE `slack_pending` ADD `kind` text DEFAULT 'status' NOT NULL;--> statement-breakpoint
ALTER TABLE `slack_pending` ADD `actor_name` text;--> statement-breakpoint
ALTER TABLE `slack_pending` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `slack_pending` ADD `file_id` text;