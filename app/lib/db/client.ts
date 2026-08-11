import "@tanstack/react-start/server-only";

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { DEFAULT_KANBAN_COLUMNS, SEED_PROCESSES } from "./schema";

/**
 * Where the SQLite file and uploaded images live. A self-hosted deployment
 * mounts a single volume at DATA_DIR and everything durable sits under it.
 */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
export const DATABASE_PATH =
  process.env.DATABASE_PATH || path.join(DATA_DIR, "hawk-shop.db");

const MIGRATIONS_DIR = path.resolve(process.env.MIGRATIONS_DIR || "./drizzle");

function openDatabase() {
  mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

  const sqlite = new Database(DATABASE_PATH);

  // WAL lets the SSE readers and the request handlers share the file without
  // blocking each other; the rest are the standard durability/latency tradeoffs
  // for a single-container app.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  // Postgres enforced the junction-table cascades; SQLite needs this per-connection.
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  if (existsSync(MIGRATIONS_DIR)) {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    console.warn(
      `[DB] Migrations folder not found at ${MIGRATIONS_DIR}; skipping migrate`
    );
  }

  seed(db);

  return db;
}

/**
 * Idempotent first-boot data: the default kanban columns and the stock process
 * list. Both use "insert if absent" so an existing database is left alone.
 */
function seed(db: ReturnType<typeof drizzle<typeof schema>>) {
  try {
    db.insert(schema.processes)
      .values(
        SEED_PROCESSES.map((process) => ({
          ...process,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))
      )
      .onConflictDoNothing()
      .run();

    db.insert(schema.kanbanConfig)
      .values({ id: "default", columns: DEFAULT_KANBAN_COLUMNS })
      .onConflictDoNothing()
      .run();
  } catch (error) {
    console.error("[DB] Seeding failed:", error);
  }
}

/**
 * Dev-mode module reloads would otherwise open a new SQLite handle on every
 * edit, so the connection is parked on globalThis.
 */
const globalForDb = globalThis as unknown as {
  __hawkShopDb?: ReturnType<typeof openDatabase>;
};

export const db = globalForDb.__hawkShopDb ?? openDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__hawkShopDb = db;
}

export { schema };
