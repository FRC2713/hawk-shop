import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { endpoint } from "./http-fixture";
import { sessionRequest } from "./request-context";

const dataDir = mkdtempSync(path.join(tmpdir(), "hawk-onshape-mfg-auth-"));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_PATH = path.join(dataDir, "hawk-shop.db");
after(() => rmSync(dataDir, { recursive: true, force: true }));

const actions = await import("../src/pages/api/mfg/parts/actions");

const postAction = endpoint(actions, "POST");

test("signed-out manufacturing requests fail before parsing their body", async () => {
  const response = await postAction(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not form data",
    }),
    {}
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Sign in with Hawk Suite to continue.",
  });
});

const cards = await import("../src/pages/api/kanban/cards/index");
const getCards = endpoint(cards, "GET");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Manufacturing auth tests must not contact Onshape");
};
after(() => {
  globalThis.fetch = originalFetch;
});

function actionRequest(
  identity: "member" | Record<string, string>,
  fields: Record<string, string>
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/mfg/parts/actions", {
    method: "POST",
    headers:
      identity === "member"
        ? Object.fromEntries(sessionRequest("test-access").headers)
        : identity,
    body: form,
  });
}
const releaseFields = {
  action: "addCard",
  partNumber: "RHR-AUTH-37",
  processIds: "process-cnc-milling",
  quantityPerRobot: "1",
  quantityToMake: "2",
  dueDate: "2026-12-01",
};
async function readCards() {
  const response = await getCards(
    new Request("http://localhost/api/kanban/cards", {
      headers: sessionRequest("test-access").headers,
    }),
    {}
  );
  assert.equal(response.status, 200);
  return (await response.json()).cards;
}

test("requests without Suite identity cannot add, move, or edit cards", async () => {
  const created = await postAction(actionRequest("member", releaseFields), {});
  assert.equal(created.status, 200);
  const cardId = (await created.json()).data.id;
  const before = await readCards();

  for (const headers of <Record<string, string>[]>[
    {},
    // Legacy Onshape cookies grant nothing.
    { Cookie: "onshape_access_token=old; onshape_user_id=submitter" },
  ]) {
    const attempts: Record<string, string>[] = [
      { ...releaseFields, partNumber: "Unauthorized duplicate" },
      { action: "moveCard", cardId, columnId: "done" },
      { action: "updateDueDate", cardId, dueDate: "2030-01-01" },
    ];
    for (const fields of attempts) {
      const response = await postAction(actionRequest(headers, fields), {});
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        success: false,
        error: "Sign in with Hawk Suite to continue.",
      });
    }
  }
  assert.deepEqual(await readCards(), before);
});

test("authenticated actions preserve successful mutations and structured validation failures", async () => {
  const response = await postAction(
    actionRequest("member", {
      ...releaseFields,
      partNumber: "RHR-AUTHENTICATED-37",
    }),
    {}
  );
  assert.equal(response.status, 200);
  const released = await response.json();
  assert.equal(released.success, true);
  assert.equal(released.data.title, "RHR-AUTHENTICATED-37");
  const cardId = released.data.id;

  // Moving and editing need only the verified session, not a user-id cookie.
  const mutations: Record<string, string>[] = [
    { action: "moveCard", cardId, columnId: "done" },
    { action: "updateDueDate", cardId, dueDate: "2026-12-15" },
  ];
  for (const fields of mutations) {
    const mutation = await postAction(actionRequest("member", fields), {});
    assert.equal(mutation.status, 200);
    assert.equal((await mutation.json()).success, true);
    assert.deepEqual(mutation.headers.getSetCookie(), []);
  }
  const persisted = (await readCards()).find(
    (card: { id: string }) => card.id === cardId
  );
  assert.equal(persisted.column_id, "done");
  assert.equal(persisted.due_date, "2026-12-15");

  const invalid = await postAction(
    actionRequest("member", { action: "moveCard", cardId }),
    {}
  );
  assert.equal(invalid.status, 400);
  const validation = await invalid.json();
  assert.equal(validation.success, false);
  assert.equal(typeof validation.error, "string");
  assert.ok(validation.error.length > 0);
});
