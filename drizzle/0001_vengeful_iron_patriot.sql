CREATE TABLE `onshape_api_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_onshape_api_cache_expires_at` ON `onshape_api_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `onshape_api_usage` (
	`day` text NOT NULL,
	`label` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `label`)
);
