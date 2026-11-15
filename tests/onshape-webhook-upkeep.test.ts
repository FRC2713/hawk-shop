import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  after,
  afterEach,
  beforeEach,
  test,
  type TestContext,
} from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-upkeep-"));
process.env.DATA_DIR = dataDir;
process.env.ONSHAPE_ACCESS_KEY = "test-access";
process.env.ONSHAPE_SECRET_KEY = "test-secret";
after(() => rm(dataDir, { recursive: true, force: true }));

const { memoryOnshape } = await import("./onshape-memory-adapter");
const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const partsRoute = await import("../src/pages/api/onshape/parts");
const usageRoute = await import("../src/pages/api/onshape/usage");
const webhookRoute =
  (await import("../src/pages/api/onshape/webhook")) as unknown as {
    POST: (context: { request: Request }) => Promise<Response>;
  };
const { onshapeWebhookWork } = await import("../src/lib/onshapeApi/webhooks");

const SECRET = "upkeep-secret";
const BASE = "https://shop.example.org";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ENV = [
  "ONSHAPE_WEBHOOK_SECRET",
  "ONSHAPE_WEBHOOK_BASE_URL",
  "ONSHAPE_CACHE_TTL_SECONDS",
  "ONSHAPE_DAILY_CALL_LIMIT",
] as const;
const originalEnvironment = new Map(ENV.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.ONSHAPE_WEBHOOK_SECRET = SECRET;
  process.env.ONSHAPE_WEBHOOK_BASE_URL = BASE;
  delete process.env.ONSHAPE_CACHE_TTL_SECONDS;
  delete process.env.ONSHAPE_DAILY_CALL_LIMIT;
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// Each test runs in its own week so the 24-hour repair limit never carries
// over from one test to the next.
let nextStart = Date.parse("2026-11-01T12:00:00Z");

type Hook = { id: string; url: string; filter: string };

/** Onshape outlives each test, like the app's database. */
const onshapeHooks = { list: [] as Hook[], nextId: 1 };

/**
 * An in-memory Onshape with a mocked clock. Parts reads answer with one part
 * whose microversion a test changes with `edit`, the way an edit in Onshape
 * does. `/webhooks` keeps the key's webhooks, which a test can drop from.
 */
function onshape(t: TestContext) {
  const start = (nextStart += 7 * DAY);
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const microversions = new Map<string, number>();
  const counts = {
    parts: 0,
    listed: 0,
    registered: 0,
    deleted: [] as string[],
  };
  const upstream = memoryOnshape(t, async (request) => {
    const url = new URL(request.url);
    const parts = /\/parts\/d\/([^/]+)\/w\/[^/]+\/e\/([^/]+)$/.exec(
      url.pathname
    );
    if (parts) {
      counts.parts++;
      const microversion = microversions.get(parts[1]!) ?? 0;
      return Response.json([
        {
          partId: "bracket",
          name: "Bracket",
          microversionId: `mv-${microversion}`,
        },
        { partId: "plate", name: "Plate", microversionId: "mv-plate" },
      ]);
    }
    if (/\/webhooks$/.test(url.pathname) && request.method === "POST") {
      counts.registered++;
      const body = (await request.json()) as { url: string; filter: string };
      const hook = {
        id: `hook-${onshapeHooks.nextId++}`,
        url: body.url,
        filter: body.filter,
      };
      onshapeHooks.list.push(hook);
      return Response.json({ id: hook.id });
    }
    if (/\/webhooks$/.test(url.pathname) && request.method === "GET") {
      counts.listed++;
      return Response.json({ items: onshapeHooks.list, next: null });
    }
    const deleted = /\/webhooks\/([^/]+)$/.exec(url.pathname);
    if (deleted && request.method === "DELETE") {
      counts.deleted.push(deleted[1]!);
      onshapeHooks.list = onshapeHooks.list.filter(
        (hook) => hook.id !== deleted[1]
      );
      return new Response(null, { status: 200 });
    }
    throw new Error(`unexpected ${request.method} ${url.pathname}`);
  });
  return {
    counts,
    upstream,
    /** Move the clock to `offsetMs` after this test's start. */
    at: (offsetMs: number) => t.mock.timers.setTime(start + offsetMs),
    /** An edit in Onshape: the document's part gets a new microversion. */
    edit: (documentId: string) =>
      microversions.set(documentId, (microversions.get(documentId) ?? 0) + 1),
    /** Onshape drops a document's webhook without saying so. */
    drop: (documentId: string) => {
      onshapeHooks.list = onshapeHooks.list.filter(
        (hook) => !hook.filter.includes(`'${documentId}'`)
      );
    },
    hooksFor: (documentId: string) =>
      onshapeHooks.list.filter((hook) =>
        hook.filter.includes(`'${documentId}'`)
      ),
  };
}

async function readParts(documentId: string, elementId = "studio") {
  const query = new URLSearchParams({
    documentId,
    instanceType: "w",
    instanceId: "workspace",
    elementId,
  });
  const request = new Request(
    `http://localhost/api/onshape/parts?${query}`,
    sessionRequest("student")
  );
  const response = await inRequest(request, () =>
    getHandler(partsRoute)({ request })
  );
  assert.equal(response.status, 200);
  await onshapeWebhookWork();
  return response;
}

async function deliver(documentId: string) {
  const url = new URL("http://localhost/api/onshape/webhook");
  url.searchParams.set("secret", process.env.ONSHAPE_WEBHOOK_SECRET ?? "");
  const response = await webhookRoute.POST({
    request: new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "onshape.model.lifecycle.changed",
        documentId,
      }),
    }),
  });
  assert.equal(response.status, 200);
  await onshapeWebhookWork();
}

async function webhookStatus() {
  const request = new Request(
    "http://localhost/api/onshape/usage",
    sessionRequest("mentor")
  );
  const response = await inRequest(request, () =>
    getHandler(usageRoute)({ request })
  );
  assert.equal(response.status, 200);
  return (await response.json()).webhooks;
}

test("a document changed with no delivery since the last read triggers one repair pass", async (t) => {
  const clock = onshape(t);
  await readParts("silent");
  assert.equal(clock.counts.registered, 1);
  clock.drop("silent");

  clock.edit("silent");
  clock.at(25 * HOUR); // the workspace read expires; no delivery came
  await readParts("silent");

  assert.equal(clock.counts.parts, 2);
  assert.equal(clock.counts.listed, 1, "one list call");
  assert.equal(clock.hooksFor("silent").length, 1, "re-registered");
  assert.equal(clock.counts.registered, 2);
});

test("a second suspicion within 24 hours of a repair pass makes no list call", async (t) => {
  process.env.ONSHAPE_CACHE_TTL_SECONDS = "3600"; // reads expire hourly
  const clock = onshape(t);
  await readParts("flapping");
  clock.edit("flapping");
  clock.at(2 * HOUR);
  await readParts("flapping");
  assert.equal(clock.counts.listed, 1);

  clock.edit("flapping");
  clock.at(4 * HOUR);
  await readParts("flapping");
  assert.equal(clock.counts.parts, 3, "the suspicious read went upstream");
  assert.equal(clock.counts.listed, 1, "no second pass within 24 hours");

  clock.edit("flapping");
  clock.at(26 * HOUR + 1);
  await readParts("flapping");
  assert.equal(clock.counts.listed, 2, "a day after the first pass, one more");
});

test("a change with a delivery since the previous read makes no list call", async (t) => {
  process.env.ONSHAPE_CACHE_TTL_SECONDS = "3600";
  const clock = onshape(t);
  await readParts("delivering");
  for (let hour = 1; hour <= 24; hour++) {
    clock.edit("delivering");
    clock.at(hour * HOUR);
    await deliver("delivering");
    clock.at(hour * HOUR + 10 * 60_000);
    await readParts("delivering");
  }
  assert.equal(clock.counts.parts, 25, "every read went upstream");
  assert.equal(clock.counts.listed, 0);
  assert.equal(clock.counts.deleted.length, 0);
  assert.equal(clock.counts.registered, 1);
});

test("an unchanged document makes no list call, delivery or not", async (t) => {
  process.env.ONSHAPE_CACHE_TTL_SECONDS = "3600";
  const clock = onshape(t);
  for (let hour = 0; hour <= 30; hour += 2) {
    clock.at(hour * HOUR);
    await readParts("quiet");
  }
  assert.equal(clock.counts.parts, 16);
  assert.equal(clock.counts.listed, 0);
});

test("boot makes no Onshape calls, then or a day later", async (t) => {
  const clock = onshape(t);
  await readParts("booted"); // a document the app already tracks
  const before = clock.upstream.requests.length;
  const now = Date.now();
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now });
  const { stopSlackWorker } = await import("../src/lib/slack/worker");
  t.after(stopSlackWorker);
  await import("../src/server/startup");
  t.mock.timers.tick(2 * DAY);
  await onshapeWebhookWork();
  assert.equal(clock.upstream.requests.length, before);
});

test("webhooks disabled: no registration, list or delete calls, whatever changes", async (t) => {
  delete process.env.ONSHAPE_WEBHOOK_SECRET;
  const clock = onshape(t);
  await readParts("disabled");
  clock.edit("disabled");
  clock.at(DAY + HOUR);
  await readParts("disabled");
  assert.equal(clock.counts.parts, 2);
  assert.deepEqual(
    clock.upstream.paths().filter((p) => /webhooks/.test(p)),
    []
  );
  assert.deepEqual(await webhookStatus(), { enabled: false });
});

test("a changed callback URL triggers one repair pass that moves the webhook", async (t) => {
  const clock = onshape(t);
  await readParts("moved");
  const [old] = clock.hooksFor("moved");
  assert.equal(old?.url, `${BASE}/api/onshape/webhook?secret=${SECRET}`);

  process.env.ONSHAPE_WEBHOOK_BASE_URL = "https://new-shop.example.org";
  clock.at(HOUR);
  await readParts("moved"); // a cache hit is enough to notice
  assert.equal(clock.counts.parts, 1);
  assert.equal(clock.counts.listed, 1);
  assert.ok(clock.counts.deleted.includes(old!.id));
  assert.ok(
    onshapeHooks.list.every((hook) => hook.url.startsWith("https://new-shop.")),
    "every tracked webhook moves, not only this document's"
  );
  const hooks = clock.hooksFor("moved");
  assert.equal(hooks.length, 1);
  assert.equal(
    hooks[0]!.url,
    `https://new-shop.example.org/api/onshape/webhook?secret=${SECRET}`
  );

  clock.at(2 * HOUR);
  await readParts("moved");
  assert.equal(clock.counts.listed, 1, "repaired: no more evidence");
});

test("reads of a document's two Part Studios don't look like changes to each other", async (t) => {
  process.env.ONSHAPE_CACHE_TTL_SECONDS = "3600";
  const clock = onshape(t);
  for (let hour = 0; hour <= 6; hour += 2) {
    clock.at(hour * HOUR);
    await readParts("two-studios", "studio");
    await readParts("two-studios", "other-studio");
  }
  assert.equal(clock.counts.parts, 8);
  assert.equal(clock.counts.listed, 0);
});

test("the last repair pass and its reason show in the usage report", async (t) => {
  const clock = onshape(t);
  await readParts("reported");
  clock.edit("reported");
  clock.at(25 * HOUR);
  await readParts("reported");
  const status = await webhookStatus();
  assert.equal(status.lastRepairAt, new Date().toISOString());
  assert.equal(status.lastRepairReason, "missed-delivery");
  assert.equal(status.lastRepairDocumentId, "reported");
});

test("evidence found with the daily ceiling reached starts no pass and spends no day", async (t) => {
  process.env.ONSHAPE_CACHE_TTL_SECONDS = "3600";
  const clock = onshape(t);
  await readParts("capped");
  clock.edit("capped");
  clock.at(25 * HOUR);
  process.env.ONSHAPE_DAILY_CALL_LIMIT = "1"; // the parts read reaches it
  await readParts("capped");
  assert.equal(clock.counts.listed, 0);

  delete process.env.ONSHAPE_DAILY_CALL_LIMIT;
  clock.edit("capped");
  clock.at(27 * HOUR);
  await readParts("capped");
  assert.equal(clock.counts.listed, 1, "the next evidence still gets a pass");
});
