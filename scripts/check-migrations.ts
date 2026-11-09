import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { migrationAllowlist } from "./migration-allowlist";

type SqlValue = string | number | bigint | Buffer | null;
export type SeedFixture = Record<string, Record<string, SqlValue>[]>;
type Journal = { entries: { tag: string }[] };
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

function tables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name != '__drizzle_migrations'"
      )
      .all() as { name: string }[]
  ).map(({ name }) => name);
}

function seed(db: Database.Database, fixtures: SeedFixture) {
  db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");
    for (const table of tables(db)) {
      if (db.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get()) continue;
      for (const row of fixtures[table] ?? []) {
        const columns = Object.keys(row);
        db.prepare(
          `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
        ).run(...Object.values(row));
      }
    }
  })();
}

function checkIntegrity(
  db: Database.Database,
  migration: string,
  failures: string[]
) {
  for (const violation of db.pragma("foreign_key_check") as {
    table: string;
    rowid: number;
    parent: string;
  }[]) {
    failures.push(
      `${migration}: ${violation.table}: foreign key violation at row ${violation.rowid}, parent ${violation.parent}`
    );
  }
  for (const result of db.pragma("integrity_check") as {
    integrity_check: string;
  }[]) {
    if (result.integrity_check !== "ok")
      failures.push(
        `${migration}: <database>: integrity_check: ${result.integrity_check}`
      );
  }
}

type Row = Record<string, SqlValue>;
function snapshot(db: Database.Database, table: string) {
  const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all() as {
    name: string;
    pk: number;
  }[];
  return {
    columns: columns.map(({ name }) => name),
    keys: columns
      .filter(({ pk }) => pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(({ name }) => name),
    rows: db.prepare(`SELECT * FROM ${quote(table)}`).all() as Row[],
  };
}

/** Checks disposable databases only. Starting-database support belongs to #61. */
export function checkMigrations(
  migrationsFolder: string,
  fixtures: SeedFixture
): string[] {
  const failures: string[] = [];
  const temp = mkdtempSync(join(tmpdir(), "hawk-migration-check-"));
  let db: Database.Database | undefined;
  let empty: Database.Database | undefined;
  let migration = "meta/_journal.json";
  try {
    const journal: Journal = JSON.parse(
      readFileSync(join(migrationsFolder, migration), "utf8")
    );
    const staged = join(temp, "drizzle");
    cpSync(migrationsFolder, staged, { recursive: true });
    empty = new Database(join(temp, "empty.db"));
    empty.pragma("journal_mode = WAL");
    empty.pragma("foreign_keys = ON");
    db = new Database(join(temp, "seeded.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    for (let index = 0; index < journal.entries.length; index++) {
      migration = `${journal.entries[index].tag}.sql`;
      const sql = readFileSync(join(migrationsFolder, migration), "utf8");
      // Only explicit DROP statements permit a table to disappear. A rebuild
      // that reuses the table name must still preserve its rows and values.
      const drops = new Set(
        [
          ...sql
            .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "")
            .matchAll(
              /(?:^|;)\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([\w]+))\s*(?=;|$)/gi
            ),
        ].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4])
      );
      seed(db, fixtures);
      const before = new Map(
        tables(db).map((table) => [table, snapshot(db!, table)])
      );
      writeFileSync(
        join(staged, "meta/_journal.json"),
        JSON.stringify({
          ...journal,
          entries: journal.entries.slice(0, index + 1),
        })
      );
      try {
        migrate(drizzle(empty), { migrationsFolder: staged });
      } catch (error) {
        failures.push(`${migration}: <empty database>: ${String(error)}`);
        break;
      }
      migrate(drizzle(db), { migrationsFolder: staged });
      checkIntegrity(db, migration, failures);
      for (const table of tables(db)) {
        if (table.startsWith("__new_") || table.startsWith("__old_")) {
          failures.push(`${migration}: ${table}: temporary table remains`);
        }
      }
      for (const [table, previous] of before) {
        if (migrationAllowlist[journal.entries[index].tag]?.trim()) continue;
        if (!tables(db).includes(table)) {
          if (!drops.has(table))
            failures.push(
              `${migration}: ${table}: table disappeared without an explicit DROP TABLE`
            );
          continue;
        }
        const current = snapshot(db, table);
        if (current.rows.length < previous.rows.length)
          failures.push(
            `${migration}: ${table}: row count decreased from ${previous.rows.length} to ${current.rows.length}`
          );
        const common = previous.columns.filter((column) =>
          current.columns.includes(column)
        );
        if (
          !previous.keys.length ||
          !previous.keys.every((key) => current.columns.includes(key))
        ) {
          failures.push(
            `${migration}: ${table}: cannot compare values by original primary key`
          );
          continue;
        }
        for (const row of previous.rows) {
          const match = current.rows.find((candidate) =>
            previous.keys.every((key) =>
              isDeepStrictEqual(candidate[key], row[key])
            )
          );
          if (!match) {
            failures.push(
              `${migration}: ${table}: primary key ${JSON.stringify(previous.keys.map((key) => row[key]))} disappeared`
            );
            continue;
          }
          for (const column of common) {
            if (!isDeepStrictEqual(row[column], match[column]))
              failures.push(
                `${migration}: ${table}: column ${column} changed for primary key ${JSON.stringify(previous.keys.map((key) => row[key]))}`
              );
          }
        }
      }
    }
    seed(db, fixtures);
    checkIntegrity(db, migration, failures);
    for (const table of tables(db)) {
      if (!fixtures[table]?.length)
        failures.push(`${migration}: ${table}: add seed rows for ${table}`);
    }
  } catch (error) {
    failures.push(`${migration}: ${String(error)}`);
  } finally {
    db?.close();
    empty?.close();
    rmSync(temp, { recursive: true, force: true });
  }
  return failures;
}
