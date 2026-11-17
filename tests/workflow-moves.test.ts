import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-workflow-moves-"));
process.env.APP_URL = "http://localhost";
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cards = await import("../src/pages/api/kanban/cards/index");
const details = await import("../src/pages/api/kanban/cards/[id]");
const actions = await import("../src/pages/api/mfg/parts/actions");
const config = await import("../src/pages/api/kanban/config/index");
const alice = await signIn();

async function release(id: string) {
  const result = await endpoint(
    cards,
    "POST"
  )(jsonRequest("/api/kanban/cards", "POST", alice, { id, title: id }));
  assert.equal(result.status, 201);
}
async function read(id: string) {
  const result = await endpoint(details, "GET", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      headers: { Cookie: alice },
    })
  );
  return (await result.json()).card;
}
async function move(id: string, columnId: string, reason?: string) {
  const body = new FormData();
  body.set("action", "moveCard");
  body.set("cardId", id);
  body.set("columnId", columnId);
  if (reason) body.set("reason", reason);
  const result = await endpoint(
    actions,
    "POST"
  )(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: { Cookie: alice, Origin: "http://localhost" },
      body,
    })
  );
  return { status: result.status, body: await result.json() };
}

test("desktop moves claim, unclaim, finish and approve through workflow actions", async () => {
  const id = "desktop-lifecycle";
  await release(id);
  assert.equal((await move(id, "in-progress")).status, 200);
  assert.equal((await read(id)).assignee, "slack:TRHR:UALICE");
  assert.equal((await move(id, "backlog")).status, 200);
  assert.equal((await read(id)).assignee, null);
  assert.equal((await move(id, "in-progress")).status, 200);
  assert.equal((await move(id, "review")).status, 200);
  assert.equal((await move(id, "done")).status, 200);
  const card = await read(id);
  assert.equal(card.column_id, "done");
  assert.equal(card.status_history.length, 6);
});

test("desktop send back requires and records a reason, and refuses skipped steps", async () => {
  const id = "desktop-send-back";
  await release(id);
  assert.equal((await move(id, "done")).status, 400);
  assert.equal((await move(id, "in-progress")).status, 200);
  assert.equal((await move(id, "review")).status, 200);
  assert.equal((await move(id, "in-progress")).status, 400);
  assert.equal((await read(id)).column_id, "review");
  assert.equal((await move(id, "in-progress", "Fix hole spacing")).status, 200);
  const card = await read(id);
  assert.equal(card.column_id, "in-progress");
  assert.equal(card.review_notes[0].text, "Fix hole spacing");
  assert.equal(card.status_history.length, 4);
});

test("desktop moves preserve custom-column navigation and reject unknown columns", async () => {
  const response = await endpoint(
    config,
    "GET"
  )(
    new Request("http://localhost/api/kanban/config", {
      headers: { Cookie: alice },
    })
  );
  const current = await response.json();
  const saved = await endpoint(
    config,
    "PUT"
  )(
    jsonRequest("/api/kanban/config", "PUT", alice, {
      columns: [
        ...current.columns,
        { id: "waiting", title: "Waiting", position: 4 },
      ],
    })
  );
  assert.equal(saved.status, 200);
  await release("desktop-custom");
  assert.equal((await move("desktop-custom", "waiting")).status, 200);
  assert.equal((await read("desktop-custom")).column_id, "waiting");
  assert.equal((await move("desktop-custom", "backlog")).status, 200);
  assert.equal((await move("desktop-custom", "deleted-column")).status, 400);
  assert.equal((await read("desktop-custom")).column_id, "backlog");
});
