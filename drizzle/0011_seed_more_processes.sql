-- Common FRC processes, added once per database. Unlike SEED_PROCESSES this
-- runs a single time, so a team can delete the ones its shop does not use.
-- OR IGNORE skips any whose id or name the team already created by hand.
INSERT OR IGNORE INTO `processes` (`id`, `name`, `description`, `created_at`, `updated_at`) VALUES
	('process-laser-cutting', 'Laser Cutting', 'Laser cutting on any machine', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-laser-fiber', 'Fiber Laser', 'Fiber laser cutting of metal sheet', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-laser-co2', 'CO2 Laser', 'CO2 laser cutting of wood, acrylic and other plastics', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-press-brake', 'Press Brake', 'Sheet metal bending on a press brake', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-lathe', 'Lathe', 'Turning shafts, spacers and standoffs', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-cnc-router', 'CNC Router', 'Routing polycarbonate and aluminum plate', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-waterjet', 'Waterjet', 'Waterjet cutting of plate', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-drill-press', 'Drill Press', 'Drilling holes in tube and plate', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-tapping', 'Tapping', 'Cutting threads in tube ends and blocks', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-sawing', 'Sawing', 'Cutting tube and bar stock to length', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-riveting', 'Riveting', 'Joining with rivets', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('process-deburring', 'Deburring', 'Edge cleanup after cutting', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
