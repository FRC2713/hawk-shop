ALTER TABLE `kanban_cards` ADD `machine_id` text REFERENCES equipment(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_kanban_cards_machine_id` ON `kanban_cards` (`machine_id`);--> statement-breakpoint
-- Link cards whose free-text machine names equipment, ignoring case. Equipment
-- names aren't unique, so the oldest match wins. Unmatched text stays as is;
-- matched text is cleared, so it can't resurface if the equipment goes.
UPDATE `kanban_cards` SET `machine_id` = (
  SELECT `equipment`.`id` FROM `equipment`
  WHERE lower(trim(`equipment`.`name`)) = lower(trim(`kanban_cards`.`machine`))
  ORDER BY `equipment`.`created_at`, `equipment`.`id`
  LIMIT 1
) WHERE `machine` IS NOT NULL AND trim(`machine`) <> '';--> statement-breakpoint
UPDATE `kanban_cards` SET `machine` = NULL WHERE `machine_id` IS NOT NULL;
