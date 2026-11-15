import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test, type TestContext } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-callsites-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest } = await import("./request-context");
const { signIn } = await import("./http-fixture");
const { memoryOnshape } = await import("./onshape-memory-adapter");
const thumbnailRoute = await import("../src/pages/api/onshape/thumbnail");
const usageRoute = await import("../src/pages/api/onshape/usage");
const webhooks = await import("../src/lib/onshapeApi/webhooks");
const { handlePartNumberUpdate } =
  await import("../src/onshape_connector/actions/partNumberUpdate");

const originalLimit = process.env.ONSHAPE_DAILY_CALL_LIMIT;
afterEach(() => {
  if (originalLimit === undefined) delete process.env.ONSHAPE_DAILY_CALL_LIMIT;
  else process.env.ONSHAPE_DAILY_CALL_LIMIT = originalLimit;
});

// Each test runs on its own UTC day, so today's tally starts at zero.
let nextDay = Date.parse("2026-11-01T12:00:00Z");
function freshDay(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date"], now: (nextDay += 7 * 86_400_000) });
}

const cookie = await signIn();

async function get(module: object, path: string) {
  const request = new Request(`http://localhost${path}`, {
    headers: { Cookie: cookie },
  });
  return inRequest(request, () => getHandler(module)({ request }));
}

/** Today's usage rows as { label: [calls, hits] }. */
async function tallyToday() {
  const today = new Date().toISOString().slice(0, 10);
  const { byDay } = await (await get(usageRoute, "/api/onshape/usage")).json();
  return Object.fromEntries(
    byDay
      .filter((row: { day: string }) => row.day === today)
      .map((row: { label: string; calls: number; hits: number }) => [
        row.label,
        [row.calls, row.hits],
      ])
  );
}

const thumbnailHref = (id: string) =>
  `https://cad.onshape.com/api/thumbnails/${id.padEnd(40, "0")}/s/300x300`;

function thumbnail(href: string, microversionId = "mv-1") {
  return get(
    thumbnailRoute,
    `/api/onshape/thumbnail?${new URLSearchParams({
      url: href,
      documentId: "doc",
      elementId: "studio",
      partId: "part",
      microversionId,
    })}`
  );
}

test("concurrent thumbnail misses share one Onshape call", async (t) => {
  freshDay(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const onshape = memoryOnshape(t, async (request) => {
    assert.equal(request.headers.get("Accept"), "*/*");
    await gate;
    return new Response("png bytes", {
      headers: { "Content-Type": "image/png" },
    });
  });
  const href = thumbnailHref("a1");
  const responses = Array.from({ length: 10 }, () => thumbnail(href));
  await new Promise((resolve) => setImmediate(resolve));
  release();
  for (const response of await Promise.all(responses)) {
    assert.equal(response.status, 307);
    assert.match(response.headers.get("Location")!, /^\/api\/files\//);
  }
  assert.equal(onshape.requests.length, 1);
  assert.deepEqual((await tallyToday()).thumbnail, [1, 9]);

  assert.equal((await thumbnail(href)).status, 307);
  assert.equal(onshape.requests.length, 1, "the stored image answers");
  assert.deepEqual((await tallyToday()).thumbnail, [1, 10]);
});

test("at the daily ceiling a stored thumbnail is served and a miss answers 503", async (t) => {
  freshDay(t);
  process.env.ONSHAPE_DAILY_CALL_LIMIT = "1";
  const onshape = memoryOnshape(
    t,
    () => new Response("png", { headers: { "Content-Type": "image/png" } })
  );
  assert.equal((await thumbnail(thumbnailHref("b1"))).status, 307);
  assert.equal((await thumbnail(thumbnailHref("b1"))).status, 307);

  const miss = await thumbnail(thumbnailHref("b2"));
  assert.equal(miss.status, 503);
  assert.match((await miss.json()).error, /^Daily Onshape budget reached/);
  assert.equal(onshape.requests.length, 1);
});

async function editPartNumber(documentId: string, partNumber = "2713-001") {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    documentId,
    instanceType: "w",
    instanceId: "ws",
    elementId: "studio",
    partId: "part",
    partNumber,
  }))
    form.set(key, value);
  const request = new Request("http://localhost/", {
    headers: { Cookie: cookie },
  });
  return (
    await inRequest(request, async () =>
      Response.json(await handlePartNumberUpdate(form, request))
    )
  ).json();
}

/** Onshape's metadata endpoint for one part: GET reads it, POST writes it. */
function metadataOnshape(t: TestContext, onRead?: () => void) {
  let value = "old";
  return memoryOnshape(t, async (request) => {
    assert.match(
      new URL(request.url).pathname,
      /^\/api\/v12\/metadata\/d\/[^/]+\/w\/ws\/e\/studio\/p\/part$/
    );
    if (request.method === "POST") {
      const body = await request.json();
      value = body.properties[0].value;
      return new Response(null, { status: 204 });
    }
    assert.equal(
      new URL(request.url).searchParams.get("includeComputedProperties"),
      "true"
    );
    onRead?.();
    return Response.json({
      properties: [{ name: "Part number", propertyId: "pn", value }],
    });
  });
}

test("a part-number write tallies its reads and its write under their own labels", async (t) => {
  freshDay(t);
  const onshape = metadataOnshape(t);
  assert.deepEqual(await editPartNumber("labelled"), { success: true });
  assert.deepEqual(
    onshape.requests.map((request) => request.method),
    ["GET", "POST", "GET"]
  );
  const tally = await tallyToday();
  assert.deepEqual(tally["metadata-read"], [2, 0]);
  assert.deepEqual(tally["metadata-write"], [1, 0]);
});

test("a part-number write crossing the ceiling finishes; the next one is refused before any call", async (t) => {
  freshDay(t);
  process.env.ONSHAPE_DAILY_CALL_LIMIT = "1";
  const onshape = metadataOnshape(t);
  assert.deepEqual(await editPartNumber("ceiling"), { success: true });
  assert.equal(onshape.requests.length, 3, "discovery, write, verification");

  const refused = await editPartNumber("ceiling", "2713-002");
  assert.equal(refused.success, false);
  assert.match(refused.error, /^Daily Onshape budget reached/);
  assert.equal(onshape.requests.length, 3);
});

/** Onshape's webhook list, as register/list/delete see it. */
function webhookOnshape(t: TestContext) {
  const hooks: { id: string; url: string }[] = [];
  let nextId = 1;
  const onshape = memoryOnshape(t, async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v6/webhooks" && request.method === "POST") {
      const body = await request.json();
      const hook = { id: `hook-${nextId++}`, url: String(body.url) };
      hooks.push(hook);
      return Response.json({ ...body, id: hook.id });
    }
    if (pathname === "/api/v6/webhooks" && request.method === "GET")
      return Response.json({ items: hooks, next: null });
    const deleted = /^\/api\/v6\/webhooks\/([^/]+)$/.exec(pathname);
    if (deleted && request.method === "DELETE") {
      hooks.splice(
        hooks.findIndex((hook) => hook.id === deleted[1]),
        1
      );
      return new Response(null, { status: 200 });
    }
    throw new Error(`unexpected ${request.method} ${pathname}`);
  });
  return { onshape, hooks };
}

function enableWebhooks(t: TestContext) {
  process.env.ONSHAPE_WEBHOOK_SECRET = "callsite-secret";
  process.env.ONSHAPE_WEBHOOK_BASE_URL = "https://shop.example.org";
  t.after(() => {
    delete process.env.ONSHAPE_WEBHOOK_SECRET;
    delete process.env.ONSHAPE_WEBHOOK_BASE_URL;
  });
}

test("webhook registration, listing and deletion go through the gateway with their labels", async (t) => {
  freshDay(t);
  enableWebhooks(t);
  const { onshape, hooks } = webhookOnshape(t);
  await webhooks.ensureOnshapeWebhook("hooked");
  await webhooks.onshapeWebhookWork();
  assert.equal(hooks.length, 1);

  // A stray pointing here that the app doesn't track gets deleted.
  hooks.push({
    id: "stray",
    url: "https://shop.example.org/api/onshape/webhook?secret=old",
  });
  await webhooks.recheckOnshapeWebhooks();
  assert.deepEqual(
    onshape.requests.map((request) => request.method),
    ["POST", "GET", "DELETE"]
  );
  const tally = await tallyToday();
  assert.deepEqual(tally["webhook-register"], [1, 0]);
  assert.deepEqual(tally["webhook-list"], [1, 0]);
  assert.deepEqual(tally["webhook-delete"], [1, 0]);
});

test("webhook upkeep makes no call once the daily ceiling is reached", async (t) => {
  freshDay(t);
  enableWebhooks(t);
  process.env.ONSHAPE_DAILY_CALL_LIMIT = "1";
  const { onshape } = webhookOnshape(t);
  await webhooks.ensureOnshapeWebhook("capped-1");
  await webhooks.onshapeWebhookWork();
  await webhooks.ensureOnshapeWebhook("capped-2");
  await webhooks.recheckOnshapeWebhooks();
  assert.equal(onshape.requests.length, 1, "only the first registration");
});
