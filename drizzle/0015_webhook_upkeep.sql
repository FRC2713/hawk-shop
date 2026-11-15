CREATE TABLE `onshape_webhook_upkeep` (
	`id` text PRIMARY KEY NOT NULL,
	`last_repair_at` text NOT NULL,
	`last_repair_reason` text NOT NULL,
	`last_repair_document_id` text
);
--> statement-breakpoint
ALTER TABLE `onshape_webhooks` ADD `observed_part_studios` text;--> statement-breakpoint
ALTER TABLE `onshape_webhooks` ADD `callback_hash` text;