CREATE TABLE `oauth_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`event` text NOT NULL,
	`subject` text,
	`client_id` text,
	`grant_id` integer,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `oauth_audit_at` ON `oauth_audit` (`at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` text NOT NULL,
	`first_granted_at` text
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`grant_id` integer NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`subject` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_grants_subject` ON `oauth_grants` (`subject`,`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_pending` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`subject` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scope` text NOT NULL,
	`state` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`tokens` real NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`grant_id` integer NOT NULL,
	`kind` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "oauth_tokens_kind" CHECK("oauth_tokens"."kind" IN ('access', 'refresh'))
);
--> statement-breakpoint
CREATE INDEX `oauth_tokens_grant` ON `oauth_tokens` (`grant_id`);