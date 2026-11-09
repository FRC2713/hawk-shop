import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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

test("migration check catches corrupted values during a rebuilt column rename", () => {
  fixture(
    [
      createParts,
      "CREATE TABLE __new_parts (id TEXT PRIMARY KEY, name TEXT NOT NULL); --> statement-breakpoint\nINSERT INTO __new_parts (id, name) SELECT id, 'LOST' FROM parts; --> statement-breakpoint\nDROP TABLE parts; --> statement-breakpoint\nALTER TABLE __new_parts RENAME TO parts;",
    ],
    (folder) => {
      assert.match(
        checkMigrations(folder, seeds).join("\n"),
        /0001_fixture\.sql.*parts.*title.*replacement column/
      );
    }
  );
});

test("migration check accepts a rebuilt rename alongside a new column", () => {
  fixture(
    [
      createParts,
      "CREATE TABLE __new_parts (id TEXT PRIMARY KEY, quantity INTEGER NOT NULL, name TEXT NOT NULL); --> statement-breakpoint\nINSERT INTO __new_parts (id, quantity, name) SELECT id, 1, title FROM parts; --> statement-breakpoint\nDROP TABLE parts; --> statement-breakpoint\nALTER TABLE __new_parts RENAME TO parts;",
    ],
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
  if (process.env.HAWK_SHOP_MIGRATION_CHECK_DB !== undefined) {
    const realFailures = checkMigrations(
      "drizzle",
      migrationFixtures,
      process.env.HAWK_SHOP_MIGRATION_CHECK_DB
    );
    assert.deepEqual(realFailures, [], realFailures.join("\n"));
  }
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

function startingDatabase(
  folder: string,
  level: number,
  run: (path: string, db: Database.Database) => void
) {
  const path = join(folder, "source.db");
  const journalPath = join(folder, "meta/_journal.json");
  const original = readFileSync(journalPath, "utf8");
  const journal = JSON.parse(original);
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, level) })
  );
  const db = new Database(path);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    migrate(drizzle(db), { migrationsFolder: folder });
    writeFileSync(journalPath, original);
    run(path, db);
  } finally {
    db.close();
  }
}

test("migration check upgrades a partial database without inserting fixture rows", () => {
  fixture(
    [
      createParts,
      "CREATE TABLE guard (n INTEGER CHECK(n = 0)); --> statement-breakpoint\nINSERT INTO guard SELECT count(*) FROM parts;",
    ],
    (folder) => {
      startingDatabase(folder, 1, (path) => {
        assert.deepEqual(checkMigrations(folder, seeds, path), []);
      });
    }
  );
});

function checkWithUnchangedSource(folder: string, path: string) {
  const files = [path, `${path}-wal`, `${path}-shm`];
  const before = files.map((file) => readFileSync(file));
  const failures = checkMigrations(folder, {}, path);
  assert.deepEqual(
    files.map((file) => readFileSync(file)),
    before
  );
  return failures;
}

test("migration check preserves source DB, WAL and SHM bytes on a successful partial upgrade", () => {
  fixture([createParts, "ALTER TABLE parts ADD notes TEXT;"], (folder) => {
    startingDatabase(folder, 1, (path, db) => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.exec("INSERT INTO parts VALUES ('real', 'WAL bracket')");
      assert.deepEqual(checkWithUnchangedSource(folder, path), []);
    });
  });
});

test("migration check catches changes to WAL-only rows and preserves source bytes on failure", () => {
  fixture([createParts, "UPDATE parts SET title = 'scrambled';"], (folder) => {
    startingDatabase(folder, 1, (path, db) => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.exec("INSERT INTO parts VALUES ('real', 'WAL bracket')");
      assert.match(
        checkWithUnchangedSource(folder, path).join("\n"),
        /0001_fixture\.sql.*parts.*title.*changed.*real/
      );
    });
  });
});

test("migration check accepts an already-head database without applying or seeding anything", () => {
  fixture([createParts], (folder) => {
    startingDatabase(folder, 1, (path) => {
      assert.deepEqual(
        checkMigrations(
          folder,
          { parts: [{ missing_column: "invalid seed" }] },
          path
        ),
        []
      );
      assert.deepEqual(checkWithUnchangedSource(folder, path), []);
    });
  });
});

test("migration check still checks integrity when the database is already at head", () => {
  fixture([createParts], (folder) => {
    startingDatabase(folder, 1, (path, db) => {
      db.exec("CREATE TABLE __new_parts (id TEXT PRIMARY KEY)");
      assert.match(
        checkWithUnchangedSource(folder, path).join("\n"),
        /__new_parts.*temporary table/
      );
    });
  });
});

test("migration check reports failing pending SQL by migration file", () => {
  fixture([createParts, "INSERT INTO missing_table VALUES (1);"], (folder) => {
    startingDatabase(folder, 1, (path) => {
      assert.match(
        checkWithUnchangedSource(folder, path).join("\n"),
        /0001_fixture\.sql.*DrizzleError/
      );
    });
  });
});

test("migration check reports an unreadable starting database instead of creating one", () => {
  fixture([createParts], (folder) => {
    assert.match(
      checkMigrations(folder, seeds, join(folder, "missing.db")).join("\n"),
      /starting database.*ENOENT/
    );
  });
});

test("migration check command uses HAWK_SHOP_MIGRATION_CHECK_DB and exits nonzero on failure", () => {
  fixture([createParts], (folder) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HAWK_SHOP_MIGRATION_CHECK_DB: join(folder, "missing.db"),
    };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--test",
        "--test-name-pattern=^real migrations preserve",
        "tests/migrations.test.ts",
      ],
      {
        encoding: "utf8",
        env,
      }
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /starting database.*ENOENT/);
  });
});
