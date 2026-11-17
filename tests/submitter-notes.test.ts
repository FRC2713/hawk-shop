import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "hawk-submitter-notes-")
);
process.env.APP_URL = "http://localhost";
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cards = await import("../src/pages/api/kanban/cards/index");
const detail = await import("../src/pages/api/kanban/cards/[id]");
const alice = await signIn();
const bob = await signIn("bob@example.com", "bob");

async function release(body: Record<string, unknown>) {
  const response = await endpoint(
    cards,
    "POST"
  )(jsonRequest("/api/kanban/cards", "POST", alice, body));
  assert.equal(response.status, 201);
  return (await response.json()).card;
}
async function read(id: string) {
  const response = await endpoint(detail, "GET", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      headers: { Cookie: alice },
    })
  );
  assert.equal(response.status, 200);
  return (await response.json()).card;
}
async function editNotes(id: string, cookie: string, content: unknown) {
  return endpoint(detail, "PATCH", { id })(
    jsonRequest(`/api/kanban/cards/${id}`, "PATCH", cookie, { content })
  );
}

test("notes left at release appear in card details with the submitter", async () => {
  const card = await release({
    id: "plate",
    title: "Side plate",
    content: "Walls at least 2 mm; deburr all edges",
  });
  const details = await read(card.id);
  assert.equal(details.content, "Walls at least 2 mm; deburr all edges");
  assert.equal(details.created_by, "slack:TRHR:UALICE");
});

test("the submitter and any other member can edit notes without status history", async () => {
  const card = await release({ id: "spacer", title: "Spacer" });
  assert.equal((await read(card.id)).content, null);

  let response = await editNotes(card.id, alice, "0.1 mm press fit");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).card.content, "0.1 mm press fit");

  response = await editNotes(card.id, bob, "0.05 mm press fit, anodize");
  assert.equal(response.status, 200);

  const after = await read(card.id);
  assert.equal(after.content, "0.05 mm press fit, anodize");
  assert.equal(after.column_id, "backlog");
  assert.equal(after.date_updated, card.date_updated);
  assert.equal(after.status_history.length, 1);
});

test("clearing notes leaves the card with no notes", async () => {
  const card = await release({ id: "gusset", title: "Gusset", content: "x" });
  const response = await editNotes(card.id, alice, "   ");
  assert.equal(response.status, 200);
  assert.equal((await read(card.id)).content, null);
});

test("notes that are not text are rejected and leave the card unchanged", async () => {
  const card = await release({ id: "hub", title: "Hub", content: "Keep" });
  const response = await editNotes(card.id, alice, { walls: 2 });
  assert.equal(response.status, 400);
  assert.equal((await read(card.id)).content, "Keep");
});
