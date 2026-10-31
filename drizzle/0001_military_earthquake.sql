CREATE TABLE `oauth_sessions` (
	`access_hash` text PRIMARY KEY NOT NULL,
	`refresh_hash` text NOT NULL,
	`onshape_user_id` text NOT NULL,
	`email` text,
	`expires_at` text NOT NULL,
	`refresh_expires_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `email` text;