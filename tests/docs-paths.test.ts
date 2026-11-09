import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkDocPaths } from "../scripts/check-docs";

test("docs path check reports the document, line, and missing path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hawk-shop-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "README.md"),
    "# Example\n\nRead `src/missing.ts`.\n"
  );
  assert.deepEqual(await checkDocPaths(root), [
    { doc: "README.md", line: 3, path: "src/missing.ts" },
  ]);
});

test("docs path check ignores globs, placeholders, and URL schemes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hawk-shop-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "README.md"),
    [
      "`src/**/*.ts` `src/<file>.ts` `src/file>.ts` `src/…/file.ts`",
      "`src/NNNN_example.ts` `https://example.org/missing.ts`",
      "`mailto:person@example.org` `virtual:hawk-shop/server-only`",
      "[external](https://example.org/missing.md) [placeholder](docs/<file>.md)",
    ].join("\n")
  );
  assert.deepEqual(await checkDocPaths(root), []);
});

test("docs path check scans all docs and resolves repo paths and relative links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hawk-shop-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs/nested"), { recursive: true });
  await writeFile(join(root, "CLAUDE.md"), "`drizzle/missing.sql`\n");
  await writeFile(join(root, "CONTEXT.md"), "`scripts/missing`\n");
  await writeFile(
    join(root, "README.md"),
    "`config.json` `tests/missing` `public/missing`\n"
  );
  await writeFile(
    join(root, "docs/nested/guide.md"),
    [
      "[missing](../missing.md#section)",
      "[existing](../../README.md#example) `docs/nested/`",
      "[repo path](src/missing.ts)",
      "```ts",
      "const example = `src/example.ts`;",
      "```",
    ].join("\n")
  );
  const failures = await checkDocPaths(root);
  assert.deepEqual(failures, [
    { doc: "CLAUDE.md", line: 1, path: "drizzle/missing.sql" },
    { doc: "README.md", line: 1, path: "config.json" },
    { doc: "README.md", line: 1, path: "tests/missing" },
    { doc: "README.md", line: 1, path: "public/missing" },
    { doc: "CONTEXT.md", line: 1, path: "scripts/missing" },
    { doc: "docs/nested/guide.md", line: 1, path: "../missing.md" },
    { doc: "docs/nested/guide.md", line: 3, path: "src/missing.ts" },
  ]);
});

test("docs path check treats Astro route brackets literally and requires directories for trailing slashes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hawk-shop-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await mkdir(join(root, "src/pages/api/files"), { recursive: true });
  await writeFile(
    join(root, "README.md"),
    "`src/pages/api/files/[...path].ts` [route](src/pages/api/files/[...path].ts)\n`src/pages/api/files/`\n"
  );
  assert.deepEqual(await checkDocPaths(root), [
    { doc: "README.md", line: 1, path: "src/pages/api/files/[...path].ts" },
  ]);
  await writeFile(join(root, "src/pages/api/files/[...path].ts"), "");
  assert.deepEqual(await checkDocPaths(root), []);
  await writeFile(
    join(root, "README.md"),
    "`src/pages/api/files/[...path].ts/`\n"
  );
  assert.deepEqual(await checkDocPaths(root), [
    { doc: "README.md", line: 1, path: "src/pages/api/files/[...path].ts/" },
  ]);
});

test("repository documentation paths exist", async () => {
  const failures = await checkDocPaths(
    fileURLToPath(new URL("../", import.meta.url))
  );
  assert.deepEqual(
    failures,
    [],
    failures
      .map(({ doc, line, path }) => `${doc}:${line}: missing ${path}`)
      .join("\n")
  );
});

test("docs path check checks file arguments in inline commands", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "hawk-shop-docs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "README.md"), "Run `node scripts/missing.mjs`.\n");
  assert.deepEqual(await checkDocPaths(root), [
    { doc: "README.md", line: 1, path: "scripts/missing.mjs" },
  ]);
});
