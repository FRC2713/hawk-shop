import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { requestHandler } from "@tanstack/start-server-core/request-response";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-shop-auth-"));
const { Route: actions } = await import("../app/routes/api/mfg/parts.actions");

type RouteHandler = (context: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;
function endpoint(
  route: unknown,
  method: string,
  params: Record<string, string> = {}
) {
  const handler = (
    route as { options: { server: { handlers: Record<string, RouteHandler> } } }
  ).options.server.handlers[method];
  return requestHandler((request) => handler({ request, params }));
}

test("signed-out connector mutations require authentication before reading the payload", async () => {
  const response = await endpoint(actions, "POST")(
    new Request("http://localhost/api/mfg/parts/actions", { method: "POST" }),
    {}
  );
  assert.equal(response.status, 401);
});

const { Route: callback } = await import("../app/routes/auth/onshape.callback");
const { Route: cards } = await import("../app/routes/api/kanban/cards.index");
const { Route: card } = await import("../app/routes/api/kanban/cards.$id");
process.env.ONSHAPE_CLIENT_ID = "test-client";
process.env.ONSHAPE_CLIENT_SECRET = "test-secret";
let signInCount = 0;
async function signIn(email: string | null = "alice@example.com") {
  const token = `access-${++signInCount}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth/token"))
      return Response.json({
        access_token: token,
        refresh_token: `refresh-${signInCount}`,
        expires_in: 3600,
      });
    if (url.endsWith("/users/current"))
      return Response.json({
        id: "alice",
        firstName: "Alice",
        email: email ?? undefined,
      });
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  try {
    const response = await endpoint(callback, "GET")(
      new Request(
        "http://localhost/auth/onshape/callback?code=test&state=test",
        { headers: { Cookie: "onshape_oauth_state=test" } }
      ),
      {}
    );
    assert.equal(response.status, 302);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
function jsonRequest(
  url: string,
  method: string,
  cookie: string,
  body: unknown
) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("releases use the authenticated submitter despite forged payload and user cookie", async () => {
  const cookie = await signIn();
  const response = await endpoint(cards, "POST")(
    jsonRequest(
      "/api/kanban/cards",
      "POST",
      `${cookie}; onshape_user_id=mallory`,
      { id: "release", title: "Bracket", createdBy: "mallory", assignee: "bob" }
    ),
    {}
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.card.created_by, "alice");
  assert.equal(result.card.assignee, "bob");
});

test("edits and moves preserve the original submitter", async () => {
  const cookie = await signIn();
  const created = await endpoint(cards, "POST")(
    jsonRequest("/api/kanban/cards", "POST", cookie, {
      id: "immutable",
      title: "Plate",
    }),
    {}
  );
  assert.equal(created.status, 201);
  const response = await endpoint(card, "PATCH", { id: "immutable" })(
    jsonRequest("/api/kanban/cards/immutable", "PATCH", cookie, {
      created_by: "mallory",
      column_id: "in-progress",
      actor: "mallory",
    }),
    {}
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).card.created_by, "alice");
});

const { Route: authStart } = await import("../app/routes/auth/onshape.index");
const { Route: logout } = await import("../app/routes/auth/logout");
const { Route: users } = await import("../app/routes/api/users.index");

test("legacy or forged identity cannot authorize manufacturing and goes through OAuth", async () => {
  const cookie = `onshape_access_token=unverified; onshape_refresh_token=unverified; onshape_expires_at=${Date.now() + 3600000}; onshape_user_id=alice`;
  for (const route of [cards, actions]) {
    const response = await endpoint(route, "POST")(
      jsonRequest("/api/mfg/parts/actions", "POST", cookie, {}),
      {}
    );
    assert.equal(response.status, 401);
  }
  const response = await endpoint(authStart, "GET")(
    new Request("http://localhost/auth/onshape?redirect=/kanban", {
      headers: { Cookie: cookie },
    }),
    {}
  );
  assert.match(response.headers.get("location")!, /oauth\/authorize/);
});

test("expired sessions cannot move cards even when the unsigned expiry is extended", async () => {
  const cookie = await signIn();
  const originalNow = Date.now;
  Date.now = () => originalNow() + 7200000;
  try {
    const forgedExpiry = cookie.replace(
      /onshape_expires_at=[^;]+/,
      `onshape_expires_at=${originalNow() + 100000000}`
    );
    const response = await endpoint(card, "PATCH", { id: "release" })(
      jsonRequest("/api/kanban/cards/release", "PATCH", forgedExpiry, {
        column_id: "done",
      }),
      {}
    );
    assert.equal(response.status, 401);
  } finally {
    Date.now = originalNow;
  }
});

test("logout revokes trusted identity even if old cookies are replayed", async () => {
  const cookie = await signIn();
  await endpoint(logout, "GET")(
    new Request("http://localhost/auth/logout", {
      headers: { Cookie: cookie },
    }),
    {}
  );
  const response = await endpoint(card, "PATCH", { id: "release" })(
    jsonRequest("/api/kanban/cards/release", "PATCH", cookie, {
      column_id: "done",
    }),
    {}
  );
  assert.equal(response.status, 401);
});

test("token renewal keeps verified identity and redirects to the requested board", async () => {
  const cookie = await signIn();
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  Date.now = () => originalNow() + 3700000;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /oauth\/token/);
    return Response.json({
      access_token: "renewed-access",
      refresh_token: "renewed-refresh",
      expires_in: 3600,
    });
  };
  try {
    const response = await endpoint(authStart, "GET")(
      new Request("http://localhost/auth/onshape?redirect=/kanban", {
        headers: { Cookie: cookie },
      }),
      {}
    );
    assert.equal(response.headers.get("location"), "http://localhost/kanban");
    const renewedCookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const created = await endpoint(cards, "POST")(
      jsonRequest("/api/kanban/cards", "POST", renewedCookie, {
        id: "renewed",
        title: "Gusset",
      }),
      {}
    );
    assert.equal(created.status, 201);
    assert.equal((await created.json()).card.created_by, "alice");
    const replay = await endpoint(cards, "POST")(
      jsonRequest("/api/kanban/cards", "POST", cookie, { title: "Replay" }),
      {}
    );
    assert.equal(replay.status, 401);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test("sign-in persists verified email and explicitly clears a missing email on the next sign-in", async () => {
  let cookie = await signIn();
  let response = await endpoint(users, "GET")(
    new Request("http://localhost/api/users", { headers: { Cookie: cookie } }),
    {}
  );
  assert.equal(
    (await response.json()).find(
      (user: { onshape_user_id: string }) => user.onshape_user_id === "alice"
    ).email,
    "alice@example.com"
  );
  cookie = await signIn(null);
  response = await endpoint(users, "GET")(
    new Request("http://localhost/api/users", { headers: { Cookie: cookie } }),
    {}
  );
  assert.equal(
    (await response.json()).find(
      (user: { onshape_user_id: string }) => user.onshape_user_id === "alice"
    ).email,
    null
  );
});

test("connector release, drag, bulk move, and card edit work without further Onshape requests", async () => {
  const cookie = await signIn();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Manufacturing mutations must not contact Onshape");
  };
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      action: "addCard",
      partNumber: "Connector bracket",
      processIds: "process-cnc-milling",
      quantityPerRobot: "1",
      quantityToMake: "2",
      createdBy: "mallory",
    }))
      form.append(key, value);
    const released = await endpoint(actions, "POST")(
      new Request("http://localhost/api/mfg/parts/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
      }),
      {}
    );
    assert.equal(released.status, 200);
    const release = (await released.json()).data;
    assert.equal(release.created_by, "alice");
    for (const column of ["in-progress", "done", "backlog"]) {
      const move = new FormData();
      move.set("action", "moveCard");
      move.set("cardId", release.id);
      move.set("columnId", column);
      move.set("actor", "mallory");
      const moved = await endpoint(actions, "POST")(
        new Request("http://localhost/api/mfg/parts/actions", {
          method: "POST",
          headers: { Cookie: cookie },
          body: move,
        }),
        {}
      );
      assert.equal(moved.status, 200);
      assert.equal((await moved.json()).data.column_id, column);
    }
    const edited = await endpoint(card, "PATCH", { id: release.id })(
      jsonRequest(`/api/kanban/cards/${release.id}`, "PATCH", cookie, {
        column_id: "done",
        title: "Edited bracket",
        created_by: "mallory",
        assignee: "bob",
      }),
      {}
    );
    assert.equal(edited.status, 200);
    const result = (await edited.json()).card;
    assert.equal(result.column_id, "done");
    assert.equal(result.created_by, "alice");
    assert.equal(result.assignee, "bob");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("payloads containing only immutable ownership fields leave the card unchanged", async () => {
  const cookie = await signIn();
  const response = await endpoint(card, "PATCH", { id: "release" })(
    jsonRequest("/api/kanban/cards/release", "PATCH", cookie, {
      id: "replaced",
      created_by: "mallory",
      date_created: "1900-01-01",
    }),
    {}
  );
  assert.equal(response.status, 200);
  const result = (await response.json()).card;
  assert.equal(result.id, "release");
  assert.equal(result.created_by, "alice");
  assert.notEqual(result.date_created, "1900-01-01");
});

test("parallel connector metadata actions use the current token without renewing it", async () => {
  const cookie = await signIn();
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  Date.now = () => originalNow() + 3400000;
  globalThis.fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    assert.match(request.url, /cad.onshape.com\/api\//);
    return Response.json(
      request.method === "GET"
        ? { properties: [{ name: "Part number", propertyId: "part-number" }] }
        : {}
    );
  };
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      partId: "p",
      partNumber: "RHR-123",
      documentId: "d",
      instanceType: "w",
      instanceId: "w",
      elementId: "e",
    }))
      form.set(key, value);
    const response = await endpoint(actions, "POST")(
      new Request("http://localhost/api/mfg/parts/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
      }),
      {}
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.getSetCookie().length, 0);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});
