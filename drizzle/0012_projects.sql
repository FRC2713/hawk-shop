CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`archived_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_name_nocase` ON `projects` (lower("name"));--> statement-breakpoint
-- Miscellaneous exists before any card can point at it; the column default
-- below backfills every existing card to it.
INSERT INTO `projects` (`id`, `name`, `created_at`, `updated_at`) VALUES ('project-miscellaneous', 'Miscellaneous', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
ALTER TABLE `kanban_cards` ADD `project_id` text DEFAULT 'project-miscellaneous' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_kanban_cards_project_id` ON `kanban_cards` (`project_id`);