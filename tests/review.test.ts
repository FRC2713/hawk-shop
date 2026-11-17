import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-review-"));
process.env.APP_URL = "http://localhost";

const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cardList = await import("../src/pages/api/kanban/cards/index");
const cardDetail = await import("../src/pages/api/kanban/cards/[id]");
const claimRoute = await import("../src/pages/api/kanban/cards/[id]/claim");
const doneRoute = await import("../src/pages/api/kanban/cards/[id]/done");
const alice = await signIn();

async function release(id: string) {
  const response = await endpoint(
    cardList,
    "POST"
  )(jsonRequest("/api/kanban/cards", "POST", alice, { id, title: id }));
  assert.equal(response.status, 201, await response.clone().text());
}

async function read(id: string) {
  const response = await endpoint(cardDetail, "GET", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      headers: { Cookie: alice },
    })
  );
  assert.equal(response.status, 200);
  return (await response.json()).card;
}

async function act(route: any, action: string, id: string, body: unknown = {}) {
  const response = await endpoint(route, "POST", { id })(
    jsonRequest(`/api/kanban/cards/${id}/${action}`, "POST", alice, body)
  );
  return { status: response.status, body: await response.json() };
}

/** Releases a part and claims it, so it is In Progress with Alice on it. */
async function inProgress(id: string) {
  await release(id);
  assert.equal((await act(claimRoute, "claim", id)).status, 200);
}

test("Done moves an In Progress part to Review", async () => {
  await inProgress("done-basic");
  const { status, body } = await act(doneRoute, "done", "done-basic");
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.column_id, "review");
  assert.equal((await read("done-basic")).column_id, "review");
});

test("Done is refused for a part that isn't In Progress", async () => {
  await release("done-backlog");
  const { status, body } = await act(doneRoute, "done", "done-backlog");
  assert.equal(status, 409);
  assert.equal(body.code, "wrong_status");
  assert.deepEqual(body.cardIds, ["done-backlog"]);
  assert.equal((await read("done-backlog")).column_id, "backlog");
});

const approveRoute = await import("../src/pages/api/kanban/cards/[id]/approve");

test("Approve moves a Review part to Done", async () => {
  await inProgress("approve-basic");
  await act(doneRoute, "done", "approve-basic");
  const { status, body } = await act(approveRoute, "approve", "approve-basic");
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.column_id, "done");
  assert.equal((await read("approve-basic")).column_id, "done");
});

test("Approve is refused for a part that isn't in Review", async () => {
  await inProgress("approve-early");
  const { status, body } = await act(approveRoute, "approve", "approve-early");
  assert.equal(status, 409);
  assert.equal(body.code, "wrong_status");
  assert.equal((await read("approve-early")).column_id, "in-progress");
});

const sendBackRoute =
  await import("../src/pages/api/kanban/cards/[id]/send-back");
const ALICE = "slack:TRHR:UALICE";

async function inReview(id: string) {
  await inProgress(id);
  assert.equal((await act(doneRoute, "done", id)).status, 200);
}

test("sending back a part with an assignee returns it to In Progress with the reason as a review note", async () => {
  await inReview("send-back-assigned");
  const { status, body } = await act(
    sendBackRoute,
    "send-back",
    "send-back-assigned",
    { reason: "  Holes are undersized  " }
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.column_id, "in-progress");
  assert.equal(body.card.assignee, ALICE);
  const card = await read("send-back-assigned");
  assert.equal(card.column_id, "in-progress");
  assert.equal(card.review_notes.length, 1);
  const [note] = card.review_notes;
  assert.equal(note.card_id, "send-back-assigned");
  assert.equal(note.author_id, ALICE);
  assert.equal(note.author_name, "Alice");
  assert.equal(note.text, "Holes are undersized");
  assert.ok(!Number.isNaN(Date.parse(note.created_at)));
  assert.deepEqual(body.card.review_notes, card.review_notes);
});

async function move(id: string, column_id: string) {
  const response = await endpoint(cardDetail, "PATCH", { id })(
    jsonRequest(`/api/kanban/cards/${id}`, "PATCH", alice, { column_id })
  );
  assert.equal(response.status, 200);
}

test("sending back a part nobody is assigned to returns it to Backlog", async () => {
  await release("send-back-unassigned");
  await move("send-back-unassigned", "review");
  const { status, body } = await act(
    sendBackRoute,
    "send-back",
    "send-back-unassigned",
    { reason: "Wrong material" }
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.column_id, "backlog");
  assert.equal(body.card.assignee, null);
  assert.deepEqual(
    body.card.review_notes.map((note: any) => note.text),
    ["Wrong material"]
  );
});

test("sending back without a reason is rejected and changes nothing", async () => {
  await inReview("send-back-silent");
  for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: 7 }]) {
    const refused = await act(
      sendBackRoute,
      "send-back",
      "send-back-silent",
      body
    );
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.ok(refused.body.error);
  }
  const card = await read("send-back-silent");
  assert.equal(card.column_id, "review");
  assert.deepEqual(card.review_notes, []);
});

test("sending back a part that isn't in Review is refused and keeps no note", async () => {
  await inProgress("send-back-early");
  const { status, body } = await act(
    sendBackRoute,
    "send-back",
    "send-back-early",
    { reason: "Too soon" }
  );
  assert.equal(status, 409);
  assert.equal(body.code, "wrong_status");
  const card = await read("send-back-early");
  assert.equal(card.column_id, "in-progress");
  assert.deepEqual(card.review_notes, []);
});

test("review notes come back oldest first on the card list too", async () => {
  await inReview("send-back-twice");
  await act(sendBackRoute, "send-back", "send-back-twice", {
    reason: "First try",
  });
  await act(doneRoute, "done", "send-back-twice");
  await act(sendBackRoute, "send-back", "send-back-twice", {
    reason: "Second try",
  });
  const response = await endpoint(
    cardList,
    "GET"
  )(
    new Request("http://localhost/api/kanban/cards", {
      headers: { Cookie: alice },
    })
  );
  assert.equal(response.status, 200);
  const cards = (await response.json()).cards as any[];
  const card = cards.find((c) => c.id === "send-back-twice");
  assert.deepEqual(
    card.review_notes.map((note: any) => note.text),
    ["First try", "Second try"]
  );
  assert.deepEqual(cards.find((c) => c.id === "done-basic").review_notes, []);
});

test("review actions on a missing card answer 404", async () => {
  assert.equal((await act(doneRoute, "done", "no-such-card")).status, 404);
  assert.equal(
    (await act(approveRoute, "approve", "no-such-card")).status,
    404
  );
  assert.equal(
    (
      await act(sendBackRoute, "send-back", "no-such-card", {
        reason: "Gone",
      })
    ).status,
    404
  );
});
