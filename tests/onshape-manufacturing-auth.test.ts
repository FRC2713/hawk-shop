import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { requestHandler } from "@tanstack/start-server-core/request-response";
import { verifySession } from "./request-context";

const dataDir = mkdtempSync(path.join(tmpdir(), "hawk-onshape-mfg-auth-"));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_PATH = path.join(dataDir, "hawk-shop.db");
after(() => rmSync(dataDir, { recursive: true, force: true }));

const { Route: actions } = await import("../app/routes/api/mfg/parts.actions");

type RouteHandler = (context: { request: Request }) => Promise<Response>;
function endpoint(route: unknown, method: string) {
  const handler = (
    route as { options: { server: { handlers: Record<string, RouteHandler> } } }
  ).options.server.handlers[method];
  return requestHandler((request) => handler({ request }));
}
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
    error: "Not authenticated with Onshape",
  });
});

const { Route: cards } = await import("../app/routes/api/kanban/cards.index");
const getCards = endpoint(cards, "GET");
const validExpiry = Date.now() + 3600000;
const validCookie = `onshape_access_token=test-access; onshape_expires_at=${validExpiry}`;
await verifySession("test-access", validExpiry);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Manufacturing auth tests must not contact Onshape");
};
after(() => {
  globalThis.fetch = originalFetch;
});

function actionRequest(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/mfg/parts/actions", {
    method: "POST",
    headers: { Cookie: cookie },
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
      headers: { Cookie: validCookie },
    }),
    {}
  );
  assert.equal(response.status, 200);
  return (await response.json()).cards;
}

test("missing, expired, and missing-expiry sessions cannot add, move, or edit cards", async () => {
  const created = await postAction(
    actionRequest(`${validCookie}; onshape_user_id=submitter`, releaseFields),
    {}
  );
  assert.equal(created.status, 200);
  const cardId = (await created.json()).data.id;
  const before = await readCards();

  for (const session of [
    "",
    `onshape_access_token=expired; onshape_expires_at=${Date.now() - 1000}`,
    "onshape_access_token=no-expiry",
  ]) {
    // Optional submitter attribution cannot authorize any of these requests.
    const cookie = `${session}; onshape_user_id=submitter`;
    const attempts: Record<string, string>[] = [
      { ...releaseFields, partNumber: "Unauthorized duplicate" },
      { action: "moveCard", cardId, columnId: "done" },
      { action: "updateDueDate", cardId, dueDate: "2030-01-01" },
    ];
    for (const fields of attempts) {
      const response = await postAction(actionRequest(cookie, fields), {});
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        success: false,
        error: "Not authenticated with Onshape",
      });
    }
  }
  assert.deepEqual(await readCards(), before);
});

test("authenticated actions preserve successful mutations and structured validation failures", async () => {
  const response = await postAction(
    actionRequest(`${validCookie}; onshape_user_id=submitter`, {
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
    const mutation = await postAction(actionRequest(validCookie, fields), {});
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
    actionRequest(validCookie, { action: "moveCard", cardId }),
    {}
  );
  assert.equal(invalid.status, 400);
  const validation = await invalid.json();
  assert.equal(validation.success, false);
  assert.equal(typeof validation.error, "string");
  assert.ok(validation.error.length > 0);
});
