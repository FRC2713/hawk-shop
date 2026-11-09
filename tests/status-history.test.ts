import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-status-history-"));
process.env.APP_URL = "http://localhost";
const { endpoint, signIn } = await import("./http-fixture");
const cards = await import("../src/server/kanbanApi/cards");
const detail = await import("../src/pages/api/kanban/cards/[id]");
const cookie = await signIn();
const actor = {
  onshape_user_id: "slack:TRHR:UALICE",
  email: "alice@example.com",
};
async function read(id: string) {
  const response = await endpoint(detail, "GET", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      headers: { Cookie: cookie },
    })
  );
  assert.equal(response.status, 200);
  return (await response.json()).card;
}

test("release appears in card details with its status, actor and timestamp", async () => {
  const card = await cards.createCard(
    { id: "release", title: "Wheel plate" },
    actor
  );
  const { status_history: history } = await read(card.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].card_id, card.id);
  assert.equal(history[0].card_title, "Wheel plate");
  assert.equal(history[0].from_column_id, null);
  assert.equal(history[0].from_status, null);
  assert.equal(history[0].from_column_index, null);
  assert.equal(history[0].to_column_id, "backlog");
  assert.equal(history[0].to_status, "Backlog");
  assert.equal(history[0].to_column_index, 0);
  assert.equal(history[0].actor_id, actor.onshape_user_id);
  assert.equal(history[0].actor_name, "Alice");
  assert.equal(history[0].moved_at, card.date_created);
});

test("moves record snapshots and backward indexes, while same-status reorders and edits add nothing", async () => {
  const card = await cards.createCard({ id: "moves", title: "Gusset" }, actor);
  await cards.updateCard(card.id, { column_id: "in-progress" }, actor);
  await cards.updateCard(card.id, { column_id: "in-progress" }, actor);
  await cards.updateCard(
    card.id,
    { title: "New title", quantity_to_make: 4 },
    actor
  );
  let history = (await read(card.id)).status_history;
  assert.equal(history.length, 2);
  assert.equal(history[1].from_status, "Backlog");
  assert.equal(history[1].to_status, "In Progress");
  assert.equal(history[1].card_title, "Gusset");
  assert.equal(history[1].from_column_index, 0);
  assert.equal(history[1].to_column_index, 1);
  assert.equal(history[1].moved_at, (await read(card.id)).date_updated);
  await cards.updateCard(card.id, { column_id: "backlog" }, actor);
  history = (await read(card.id)).status_history;
  assert.equal(history.length, 3);
  assert.equal(history[2].from_column_index, 1);
  assert.equal(history[2].to_column_index, 0);
  assert.equal(history[2].card_title, "New title");
});

test("bulk moves retain one transition per card and history survives deletion", async () => {
  const ids = ["bulk-a", "bulk-b", "bulk-c"];
  for (const id of ids) await cards.createCard({ id, title: id }, actor);
  // The board bulk action sends the same PATCH once for each selected card.
  const { jsonRequest } = await import("./http-fixture");
  await Promise.all(
    ids.map(async (id) => {
      const response = await endpoint(detail, "PATCH", { id })(
        jsonRequest(`/api/kanban/cards/${id}`, "PATCH", cookie, {
          column_id: "review",
        })
      );
      assert.equal(response.status, 200);
    })
  );
  for (const id of ids) {
    const history = (await read(id)).status_history;
    assert.equal(history.length, 2);
    assert.equal(history[1].to_status, "Review");
    await cards.deleteCard(id);
    assert.deepEqual(await cards.getCardStatusHistory(id), history);
  }
});

test("column renames and reordering preserve historical names and indexes", async () => {
  const { getKanbanConfig, saveKanbanConfig } =
    await import("../src/server/kanbanApi/config");
  const original = await getKanbanConfig();
  try {
    const card = await cards.createCard(
      { id: "rename", title: "Bracket" },
      actor
    );
    await cards.updateCard(card.id, { column_id: "review" }, actor);
    const before = (await read(card.id)).status_history;
    await saveKanbanConfig({
      columns: original.columns.map((column) => ({
        ...column,
        title: column.id === "review" ? "Inspection" : column.title,
        position: column.id === "review" ? 0 : column.position + 1,
      })),
    });
    assert.deepEqual((await read(card.id)).status_history, before);
    await cards.updateCard(card.id, { column_id: "backlog" }, actor);
    const move = (await read(card.id)).status_history[2];
    assert.equal(move.from_status, "Inspection");
    assert.equal(move.from_column_index, 0);
    assert.equal(move.to_column_index, 1);
  } finally {
    await saveKanbanConfig(original);
  }
});

test("failed creation leaves no release history and card details require membership", async () => {
  await assert.rejects(
    cards.createCard({ id: "release", title: "Duplicate" }, actor)
  );
  assert.equal((await read("release")).status_history.length, 1);
  const response = await endpoint(detail, "GET", { id: "release" })(
    new Request("http://localhost/api/kanban/cards/release")
  );
  assert.equal(response.status, 401);
});

test("storage failure rolls back the card and its history together", async () => {
  const { default: Database } = await import("better-sqlite3");
  const storage = new Database(
    path.join(process.env.DATA_DIR!, "hawk-shop.db")
  );
  const before = await read("moves");
  try {
    // Fail at the durable-storage boundary rather than mocking repository helpers.
    storage.exec(`CREATE TRIGGER fail_history_insert BEFORE INSERT ON status_history
      BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END`);
    await assert.rejects(
      cards.updateCard("moves", { column_id: "done" }, actor)
    );
    assert.deepEqual(await read("moves"), before);
    await assert.rejects(
      cards.createCard({ id: "failed-release", title: "Plate" }, actor)
    );
    const response = await endpoint(detail, "GET", { id: "failed-release" })(
      new Request("http://localhost/api/kanban/cards/failed-release", {
        headers: { Cookie: cookie },
      })
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await cards.getCardStatusHistory("failed-release"), []);
  } finally {
    storage.exec("DROP TRIGGER IF EXISTS fail_history_insert");
    storage.close();
  }
});
