CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`location` text,
	`status` text,
	`documentation_url` text,
	`image_urls` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `equipment_processes` (
	`equipment_id` text NOT NULL,
	`process_id` text NOT NULL,
	PRIMARY KEY(`equipment_id`, `process_id`),
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`process_id`) REFERENCES `processes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_equipment_processes_equipment_id` ON `equipment_processes` (`equipment_id`);--> statement-breakpoint
CREATE INDEX `idx_equipment_processes_process_id` ON `equipment_processes` (`process_id`);--> statement-breakpoint
CREATE TABLE `kanban_card_processes` (
	`card_id` text NOT NULL,
	`process_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `process_id`),
	FOREIGN KEY (`card_id`) REFERENCES `kanban_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`process_id`) REFERENCES `processes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_kanban_card_processes_card_id` ON `kanban_card_processes` (`card_id`);--> statement-breakpoint
CREATE INDEX `idx_kanban_card_processes_process_id` ON `kanban_card_processes` (`process_id`);--> statement-breakpoint
CREATE TABLE `kanban_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`column_id` text NOT NULL,
	`title` text NOT NULL,
	`image_url` text,
	`assignee` text,
	`date_created` text NOT NULL,
	`date_updated` text NOT NULL,
	`machine` text,
	`due_date` text,
	`content` text,
	`created_by` text,
	`quantity_per_robot` integer,
	`quantity_to_make` integer,
	`onshape_document_id` text,
	`onshape_instance_type` text,
	`onshape_instance_id` text,
	`onshape_element_id` text,
	`onshape_part_id` text,
	`onshape_version_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_kanban_cards_column_id` ON `kanban_cards` (`column_id`);--> statement-breakpoint
CREATE INDEX `idx_kanban_cards_date_created` ON `kanban_cards` (`date_created`);--> statement-breakpoint
CREATE TABLE `kanban_config` (
	`id` text PRIMARY KEY NOT NULL,
	`columns` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `part_thumbnails` (
	`document_id` text NOT NULL,
	`instance_type` text NOT NULL,
	`instance_id` text NOT NULL,
	`element_id` text NOT NULL,
	`part_id` text NOT NULL,
	`storage_path` text NOT NULL,
	`source_url` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`document_id`, `instance_type`, `instance_id`, `element_id`, `part_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_part_thumbnails_source_url` ON `part_thumbnails` (`source_url`);--> statement-breakpoint
CREATE TABLE `processes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `processes_name_unique` ON `processes` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`onshape_user_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
