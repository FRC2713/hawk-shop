CREATE TABLE `slack_pending` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL,
	`submitter_id` text,
	`submitter_name` text NOT NULL,
	`submitter_email` text,
	`old_column_id` text NOT NULL,
	`new_column_id` text NOT NULL,
	`old_status` text NOT NULL,
	`new_status` text NOT NULL,
	`title` text NOT NULL,
	`quantity_to_make` integer,
	`channel_id` text NOT NULL,
	`generation` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE TABLE `slack_post_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`next_post_at` text NOT NULL
);
