import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-errors-"));
process.env.APP_URL = "http://localhost";
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cards = await import("../src/pages/api/kanban/cards/index");
const { apiFetch, ApiError } = await import("../src/lib/api/client");

test("a failed card request preserves its error payload and correlates the browser error with the server stack", async (t) => {
  const cookie = await signIn();
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
  const request = () =>
    jsonRequest("/api/kanban/cards", "POST", cookie, {
      id: "duplicate",
      title: "Fixture",
    });
  assert.equal((await endpoint(cards, "POST")(request())).status, 201);
  const response = await endpoint(cards, "POST")(request());
  assert.equal(response.status, 500);
  const body = await response.clone().json();
  assert.match(body.error, /UNIQUE constraint failed/);
  assert.match(body.errorId, /^[a-f0-9]{12}$/);
  assert.ok(
    logs.some(
      (args) =>
        String(args[0]).includes(`[KANBAN CARDS]`) &&
        String(args[0]).includes(body.errorId) &&
        args.some(
          (value) => value instanceof Error && value.stack?.includes("Error")
        )
    )
  );
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(
    apiFetch("/api/kanban/cards"),
    (error) =>
      error instanceof ApiError &&
      error.message === body.error &&
      error.errorId === body.errorId
  );
});

test("rejected connector operations retain success false and an error reference", async (t) => {
  t.mock.method(console, "error", () => {});
  const route = await import("../src/pages/api/mfg/parts/actions");
  const body = new FormData();
  body.set("action", "moveCard");
  body.set("cardId", "does-not-exist");
  body.set("columnId", "done");
  const response = await endpoint(
    route,
    "POST"
  )(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: { Cookie: await signIn(), Origin: "http://localhost" },
      body,
    })
  );
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.success, false);
  assert.equal(result.error, "Card not found");
  assert.match(result.errorId, /^[a-f0-9]{12}$/);
});
