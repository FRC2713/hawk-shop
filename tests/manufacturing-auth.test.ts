import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "hawk-shop-suite-actors-")
);
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cards = await import("../src/pages/api/kanban/cards/index");
const card = await import("../src/pages/api/kanban/cards/[id]");
const actions = await import("../src/pages/api/mfg/parts/actions");

test("Onshape credentials and unsigned identity cookies never authorize manufacturing", async () => {
  const cookie = `onshape_access_token=forged; onshape_user_id=alice; onshape_expires_at=${Date.now() + 3600000}`;
  for (const route of [cards, actions]) {
    const response = await endpoint(
      route,
      "POST"
    )(
      new Request("http://localhost/api/mfg/parts/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: "invalid form",
      })
    );
    assert.equal(response.status, 401);
  }
});

test("releases use the verified Suite submitter despite a forged payload and CAD identity", async () => {
  const cookie = await signIn();
  const response = await endpoint(
    cards,
    "POST"
  )(
    jsonRequest(
      "/api/kanban/cards",
      "POST",
      `${cookie}; onshape_user_id=mallory`,
      { id: "release", title: "Bracket", createdBy: "mallory", assignee: "bob" }
    )
  );
  assert.equal(response.status, 201);
  const released = (await response.json()).card;
  assert.equal(released.created_by, "slack:TRHR:UALICE");
  assert.equal(released.assignee, "bob");
});

test("card edits preserve submitter, identity and creation date", async () => {
  const cookie = await signIn();
  const initial = await endpoint(
    cards,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", cookie, {
      id: "immutable",
      title: "Plate",
    })
  );
  const before = (await initial.json()).card;
  const response = await endpoint(card, "PATCH", { id: "immutable" })(
    jsonRequest("/api/kanban/cards/immutable", "PATCH", cookie, {
      created_by: "mallory",
      id: "other",
      date_created: "2000-01-01",
      column_id: "in-progress",
      actor: "mallory",
    })
  );
  assert.equal(response.status, 200);
  const updated = (await response.json()).card;
  assert.equal(updated.created_by, "slack:TRHR:UALICE");
  assert.equal(updated.id, "immutable");
  assert.equal(updated.date_created, before.date_created);
  const noChange = await endpoint(card, "PATCH", { id: "immutable" })(
    jsonRequest("/api/kanban/cards/immutable", "PATCH", cookie, {
      created_by: "mallory",
    })
  );
  assert.deepEqual((await noChange.json()).card, updated);
});

test("manufacturing works with Suite alone and does not fetch Onshape", async (t) => {
  const cookie = (await signIn()).split(";")[0];
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Local manufacturing must not call CAD");
  });
  const form = new FormData();
  for (const [key, value] of Object.entries({
    action: "addCard",
    partNumber: "SUITE-ONLY",
    processIds: "process-cnc-milling",
    projectId: "project-miscellaneous",
    quantityPerRobot: "2",
    quantityToMake: "4",
  }))
    form.set(key, value);
  const release = await endpoint(
    actions,
    "POST"
  )(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    })
  );
  assert.equal(release.status, 200);
  const created = (await release.json()).data;
  assert.equal(created.created_by, "slack:TRHR:UALICE");
  assert.equal(created.quantity_to_make, 4);
  const actor = await signIn("bob@example.com", "bob");
  const updated = await endpoint(card, "PATCH", { id: created.id })(
    jsonRequest("/api/kanban/cards/" + created.id, "PATCH", actor, {
      column_id: "done",
      due_date: "2027-01-01",
      assignee: "slack:TRHR:UBOB",
    })
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).card.created_by, "slack:TRHR:UALICE");
});

test("gateway session removal denies replayed CAD cookies", async () => {
  const cookie = await signIn();
  const cadOnly = cookie.split(";").slice(1).join(";");
  const response = await endpoint(card, "PATCH", { id: "release" })(
    jsonRequest("/api/kanban/cards/release", "PATCH", cadOnly, {
      column_id: "done",
    })
  );
  assert.equal(response.status, 401);
});

test("Suite profile refresh saves verified email and clears a removed claim", async () => {
  await signIn("verified@example.com");
  const { getUserRecordById } = await import("../src/server/db/users");
  assert.equal(
    (await getUserRecordById("slack:TRHR:UALICE"))?.email,
    "verified@example.com"
  );
  await signIn(null);
  assert.equal((await getUserRecordById("slack:TRHR:UALICE"))?.email, null);
});
