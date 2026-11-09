CREATE TABLE `onshape_webhooks` (
	`document_id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`registered_at` text NOT NULL,
	`last_event_at` text,
	`last_checked_at` text
);
