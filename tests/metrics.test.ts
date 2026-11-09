import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-metrics-"));
process.env.APP_URL = "http://localhost";
const { endpoint, signIn } = await import("./http-fixture");
const { db } = await import("../src/server/db/client");
const { statusHistory } = await import("../src/server/db/schema");
const route = await import("../src/pages/api/metrics");
const cookie = await signIn();
async function read(query = "start=2026-01-01&end=2026-01-31") {
  const response = await endpoint(
    route,
    "GET"
  )(
    new Request(`http://localhost/api/metrics?${query}`, {
      headers: { Cookie: cookie },
    })
  );
  assert.equal(response.status, 200);
  return response.json();
}
async function move(
  card: string,
  day: number,
  from: number | null,
  to: number
) {
  const ids = ["backlog", "in-progress", "review", "done"];
  const names = ["Backlog", "In Progress", "Review", "Done"];
  await db.insert(statusHistory).values({
    card_id: card,
    card_title: card,
    from_column_id: from === null ? null : ids[from],
    to_column_id: ids[to],
    from_status: from === null ? null : names[from],
    to_status: names[to],
    from_column_index: from,
    to_column_index: to,
    actor_id: "fixture",
    actor_name: "Fixture",
    moved_at: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  });
}

test("fixed history returns dwell percentiles, release-to-done cycles and Monday weekly completions", async () => {
  await move("a", 1, null, 0);
  await move("a", 2, 0, 1);
  await move("a", 5, 1, 3);
  await move("b", 1, null, 0);
  await move("b", 4, 0, 1);
  await move("b", 10, 1, 3);
  const result = await read();
  assert.deepEqual(result.statuses, [
    {
      column_id: "backlog",
      status: "Backlog",
      samples: 2,
      median_ms: 172800000,
      p90_ms: 259200000,
      max_ms: 259200000,
      backward_moves: 0,
    },
    {
      column_id: "in-progress",
      status: "In Progress",
      samples: 2,
      median_ms: 388800000,
      p90_ms: 518400000,
      max_ms: 518400000,
      backward_moves: 0,
    },
  ]);
  assert.deepEqual(result.cycle, { samples: 2, median_ms: 561600000 });
  assert.deepEqual(result.processes, [
    { process_id: null, process: "unknown", samples: 2, median_ms: 561600000 },
  ]);
  assert.deepEqual(result.weeks, [{ week_start: "2026-01-05", cards_done: 2 }]);
});

test("cycles use current processes and deleted cards remain unknown without multiplying totals", async () => {
  const { createCard, setCardProcesses, deleteCard } =
    await import("../src/server/kanbanApi/cards");
  const { processes } = await import("../src/server/db/schema");
  await db.insert(processes).values([
    { id: "fixture-laser", name: "Fixture laser" },
    { id: "fixture-lathe", name: "Fixture lathe" },
  ]);
  await createCard(
    { id: "a", title: "A", processIds: ["fixture-laser", "fixture-lathe"] },
    { onshape_user_id: "slack:TRHR:UALICE", email: "alice@example.com" }
  );
  let result = await read();
  assert.deepEqual(result.processes, [
    {
      process_id: "fixture-laser",
      process: "Fixture laser",
      samples: 1,
      median_ms: 345600000,
    },
    {
      process_id: "fixture-lathe",
      process: "Fixture lathe",
      samples: 1,
      median_ms: 345600000,
    },
    { process_id: null, process: "unknown", samples: 1, median_ms: 777600000 },
  ]);
  await setCardProcesses("a", ["fixture-lathe"]);
  result = await read();
  assert.equal(result.processes.length, 2);
  assert.equal(result.cycle.samples, 2);
  await deleteCard("a");
  assert.deepEqual((await read()).processes, [
    { process_id: null, process: "unknown", samples: 2, median_ms: 561600000 },
  ]);
});

test("date range selects exit moves, keeps earlier entry times, excludes open visits and never guesses legacy releases", async () => {
  await move("legacy", 2, 0, 1);
  await move("legacy", 6, 1, 0);
  await move("legacy", 8, 0, 3);
  await move("open", 3, null, 0);
  // A Sunday completion belongs to the preceding Monday, including across years.
  await move("sunday", 1, null, 0);
  await move("sunday", 4, 0, 3);
  const result = await read("start=2026-01-06&end=2026-01-08");
  assert.deepEqual(result.statuses, [
    {
      column_id: "backlog",
      status: "Backlog",
      backward_moves: 0,
      samples: 1,
      median_ms: 172800000,
      p90_ms: 172800000,
      max_ms: 172800000,
    },
    {
      column_id: "in-progress",
      status: "In Progress",
      backward_moves: 1,
      samples: 1,
      median_ms: 345600000,
      p90_ms: 345600000,
      max_ms: 345600000,
    },
  ]);
  assert.deepEqual(result.cycle, { samples: 0, median_ms: null });
  assert.deepEqual(result.weeks, [{ week_start: "2026-01-05", cards_done: 1 }]);
  const sunday = await read("start=2026-01-04&end=2026-01-04");
  assert.deepEqual(sunday.weeks, [{ week_start: "2025-12-29", cards_done: 1 }]);
});

test("reopening does not buy a second cycle or completion, and stored indexes survive config changes", async () => {
  const { getKanbanConfig, saveKanbanConfig } =
    await import("../src/server/kanbanApi/config");
  const original = await getKanbanConfig();
  await move("a", 11, 3, 1);
  await move("a", 12, 1, 3);
  try {
    await saveKanbanConfig({
      columns: original.columns.map((column) => ({
        ...column,
        title: `Renamed ${column.title}`,
        position: 100 - column.position,
      })),
    });
    const result = await read("start=2026-01-11&end=2026-01-12");
    assert.deepEqual(result.weeks, []);
    assert.deepEqual(result.cycle, { samples: 0, median_ms: null });
    assert.equal(
      result.statuses.find(
        (row: { column_id: string }) => row.column_id === "done"
      ).backward_moves,
      1
    );
    assert.equal(
      result.statuses.find(
        (row: { column_id: string }) => row.column_id === "done"
      ).status,
      "Done"
    );
    // A different final column changes the done definition exactly as on overview.
    await saveKanbanConfig({
      columns: [...original.columns.slice(1), original.columns[0]],
    });
    assert.equal(
      (await read("start=2026-01-01&end=2026-01-01")).weeks[0].cards_done,
      3
    );
  } finally {
    await saveKanbanConfig(original);
  }
});

test("metrics require identity, validate calendar dates and use a 30-day UTC default", async () => {
  const unauthorized = await endpoint(
    route,
    "GET"
  )(new Request("http://localhost/api/metrics?start=bad"));
  assert.equal(unauthorized.status, 401);
  for (const query of [
    "start=2026-02-30",
    "end=bad",
    "start=2026-01-02&end=2026-01-01",
    "start=2026-1-01",
    "start=",
  ]) {
    const response = await endpoint(
      route,
      "GET"
    )(
      new Request(`http://localhost/api/metrics?${query}`, {
        headers: { Cookie: cookie },
      })
    );
    assert.equal(response.status, 400, query);
  }
  const { parseMetricsRange } = await import("../src/server/kanbanApi/metrics");
  assert.deepEqual(
    parseMetricsRange(new URLSearchParams(), new Date("2026-03-01T23:59:00Z")),
    { start: "2026-01-31", end: "2026-03-01" }
  );
  const empty = await read("start=2025-01-01&end=2025-01-01");
  assert.deepEqual(empty.statuses, []);
  assert.deepEqual(empty.processes, []);
  assert.deepEqual(empty.weeks, []);
  assert.deepEqual(empty.cycle, { samples: 0, median_ms: null });
});
