CREATE TABLE `slack_config` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text,
	`channel_name` text,
	`enabled` integer DEFAULT false NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
