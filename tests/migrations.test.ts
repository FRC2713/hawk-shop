import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkMigrations } from "../scripts/check-migrations";
import { migrationFixtures } from "./migration-fixtures";

function fixture(sql: string[], run: (folder: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), "hawk-migration-fixture-"));
  try {
    mkdirSync(join(folder, "meta"));
    const entries = sql.map((statement, idx) => {
      const tag = `000${idx}_fixture`;
      writeFileSync(join(folder, `${tag}.sql`), statement);
      return { idx, version: "6", when: idx + 1, tag, breakpoints: true };
    });
    writeFileSync(
      join(folder, "meta/_journal.json"),
      JSON.stringify({ version: "7", dialect: "sqlite", entries })
    );
    run(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const createParts =
  "CREATE TABLE parts (id TEXT PRIMARY KEY, title TEXT NOT NULL);";
const seeds = {
  parts: [
    { id: "a", title: "Bracket" },
    { id: "b", title: "Gusset" },
  ],
};

test("migration check catches a rebuild that forgets to copy rows", () => {
  fixture(
    [
      createParts,
      "CREATE TABLE __new_parts (id TEXT PRIMARY KEY, title TEXT NOT NULL); --> statement-breakpoint\nDROP TABLE parts; --> statement-breakpoint\nALTER TABLE __new_parts RENAME TO parts;",
    ],
    (folder) => {
      assert.match(
        checkMigrations(folder, seeds).join("\n"),
        /0001_fixture\.sql.*parts.*row count/
      );
    }
  );
});

test("migration check rejects leftover rebuild tables", () => {
  fixture(
    [createParts, "CREATE TABLE __new_parts (id TEXT PRIMARY KEY);"],
    (folder) => {
      assert.match(
        checkMigrations(folder, seeds).join("\n"),
        /0001_fixture\.sql.*__new_parts.*temporary table/
      );
    }
  );
});

test("migration check preserves values by primary key across a correct column rename", () => {
  fixture(
    [createParts, "ALTER TABLE parts RENAME COLUMN title TO name;"],
    (folder) => {
      assert.deepEqual(checkMigrations(folder, seeds), []);
    }
  );
});

test("migration check catches scrambled values even when row counts are unchanged", () => {
  fixture(
    [
      createParts,
      "UPDATE parts SET title = CASE id WHEN 'a' THEN 'Gusset' ELSE 'Bracket' END;",
    ],
    (folder) => {
      assert.match(
        checkMigrations(folder, seeds).join("\n"),
        /0001_fixture\.sql.*parts.*title.*changed/
      );
    }
  );
});

test("migration check requires seed rows even for a table created by the last migration", () => {
  fixture([createParts], (folder) => {
    assert.match(
      checkMigrations(folder, {}).join("\n"),
      /0000_fixture\.sql.*parts.*add seed rows for parts/
    );
  });
});

test("migration check catches invalid foreign-key schemas", () => {
  fixture(
    [
      createParts,
      "CREATE TABLE links (id TEXT PRIMARY KEY, title TEXT REFERENCES parts(title));",
    ],
    (folder) => {
      assert.match(
        checkMigrations(folder, seeds).join("\n"),
        /0001_fixture\.sql.*foreign key/i
      );
    }
  );
});

test("migration check rejects unexpected table disappearance and permits explicit drops", () => {
  fixture(
    [createParts, "ALTER TABLE parts RENAME TO hidden_parts;"],
    (folder) => {
      assert.match(
        checkMigrations(folder, seeds).join("\n"),
        /0001_fixture\.sql.*parts.*table disappeared/
      );
    }
  );
  fixture([createParts, "DROP TABLE parts;"], (folder) => {
    assert.deepEqual(checkMigrations(folder, seeds), []);
  });
});

test("migration check also runs the chain without seed rows", () => {
  fixture(
    [
      createParts,
      "CREATE TABLE guard (n INTEGER CHECK(n > 0)); --> statement-breakpoint\nINSERT INTO guard SELECT count(*) FROM parts;",
    ],
    (folder) => {
      assert.match(
        checkMigrations(folder, { ...seeds, guard: [{ n: 1 }] }).join("\n"),
        /0001_fixture\.sql.*empty database/
      );
    }
  );
});

test("real migrations preserve representative rows in every current table", () => {
  const failures = checkMigrations("drizzle", migrationFixtures);
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("migration check names a missing journal-listed SQL file", () => {
  fixture([createParts, "ALTER TABLE parts ADD notes TEXT;"], (folder) => {
    rmSync(join(folder, "0001_fixture.sql"));
    assert.match(
      checkMigrations(folder, seeds).join("\n"),
      /0001_fixture\.sql.*ENOENT/
    );
  });
});

test("migration check compares the full composite primary key", () => {
  fixture(
    [
      "CREATE TABLE links (card TEXT, process TEXT, notes TEXT, PRIMARY KEY(card, process));",
      "UPDATE links SET notes = 'wrong' WHERE card = 'a' AND process = 'inspect';",
    ],
    (folder) => {
      const failures = checkMigrations(folder, {
        links: [
          { card: "a", process: "mill", notes: "Cut" },
          { card: "a", process: "inspect", notes: "Measure" },
          { card: "b", process: "mill", notes: "Drill" },
        ],
      });
      assert.equal(failures.length, 1);
      assert.match(
        failures[0],
        /0001_fixture\.sql.*links.*notes.*changed.*\["a","inspect"\]/
      );
    }
  );
});
