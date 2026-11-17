CREATE TABLE `station_roster` (
	`user_id` text NOT NULL,
	`process_id` text NOT NULL,
	`shop_day` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`process_id`, `shop_day`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`onshape_user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`process_id`) REFERENCES `processes`(`id`) ON UPDATE no action ON DELETE cascade
);
