CREATE TABLE `onshape_api_remaining` (
	`label` text PRIMARY KEY NOT NULL,
	`remaining` integer,
	`observed_at` text NOT NULL,
	`last_status` integer NOT NULL
);
