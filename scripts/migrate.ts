/**
 * Standalone migration runner.
 *
 * The app also migrates on boot (see app/lib/db/client.ts), so this exists for
 * the cases where you want to migrate without starting the server — CI, a
 * pre-deploy step, or checking a migration applies cleanly.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dataDir = path.resolve(process.env.DATA_DIR || "./data");
const databasePath =
  process.env.DATABASE_PATH || path.join(dataDir, "hawk-shop.db");

mkdirSync(path.dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
sqlite.close();

console.log(`[MIGRATE] Applied migrations to ${databasePath}`);
