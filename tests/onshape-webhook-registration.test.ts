import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-webhook-reg-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const partsRoute = await import("../src/pages/api/onshape/parts");
const usageRoute = await import("../src/pages/api/onshape/usage");
const webhookRoute = await import("../src/pages/api/onshape/webhook");
const { onshapeWebhookWork, startOnshapeWebhookChecks } =
  await import("../src/lib/onshapeApi/webhooks");

const SECRET = "correct-horse-battery-staple";
const BASE = "https://shop.example.org";
const CALLBACK = `${BASE}/api/onshape/webhook?secret=${SECRET}`;

beforeEach(() => {
  process.env.ONSHAPE_WEBHOOK_SECRET = SECRET;
  process.env.ONSHAPE_WEBHOOK_BASE_URL = BASE;
});

type Hook = { id: string; url: string; filter: string };

/** Onshape's list of webhooks outlives each test, like the app's database. */
const onshapeHooks = { list: [] as Hook[], nextId: 1 };

/**
 * A fake Onshape: parts reads succeed, and `/webhooks` keeps a list of
 * registered webhooks that a test can drop entries from, as Onshape does.
 * Counters start at zero for each test.
 */
function fakeOnshape(t: { mock: { method: Function } }) {
  const state = {
    get hooks() {
      return onshapeHooks.list;
    },
    set hooks(list: Hook[]) {
      onshapeHooks.list = list;
    },
    registered: [] as { filter: string; body: Record<string, unknown> }[],
    listed: 0,
    deleted: [] as string[],
    partsReads: 0,
    failRegistration: false,
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (/\/parts\/d\//.test(url.pathname)) {
        state.partsReads++;
        return Response.json([{ partId: "part", name: "Part" }]);
      }
      if (/^\/api\/v\d+\/webhooks$/.test(url.pathname)) {
        if (request.method === "POST") {
          if (state.failRegistration)
            return Response.json({ message: "nope" }, { status: 500 });
          const body = (await request.json()) as Record<string, unknown>;
          const hook = {
            id: `hook-${onshapeHooks.nextId++}`,
            url: String(body.url),
            filter: String(body.filter),
          };
          state.hooks.push(hook);
          state.registered.push({ filter: hook.filter, body });
          return Response.json({ ...body, id: hook.id });
        }
        if (request.method === "GET") {
          state.listed++;
          return Response.json({ items: state.hooks, next: null });
        }
      }
      const del = /^\/api\/v\d+\/webhooks\/([^/]+)$/.exec(url.pathname);
      if (del && request.method === "DELETE") {
        state.deleted.push(del[1]);
        state.hooks = state.hooks.filter((hook) => hook.id !== del[1]);
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected ${request.method} ${request.url}`);
    }
  );
  const registeredFor = (documentId: string) =>
    state.registered.filter((entry) => entry.filter.includes(`'${documentId}'`))
      .length;
  return { state, registeredFor };
}

async function readParts(documentId: string, instanceType = "w") {
  const query = new URLSearchParams({
    documentId,
    instanceType,
    instanceId: "instance",
    elementId: "studio",
  });
  const request = new Request(
    `http://localhost/api/onshape/parts?${query}`,
    sessionRequest("student")
  );
  const response = await inRequest(request, () =>
    getHandler(partsRoute)({ request })
  );
  await onshapeWebhookWork();
  return response;
}

async function readUsage() {
  const request = new Request(
    "http://localhost/api/onshape/usage",
    sessionRequest("mentor")
  );
  const response = await inRequest(request, () =>
    getHandler(usageRoute)({ request })
  );
  assert.equal(response.status, 200);
  return response.json();
}

function callsFor(
  usage: { byDay: { label: string; calls: number }[] },
  label: string
) {
  return usage.byDay
    .filter((row) => row.label === label)
    .reduce((sum, row) => sum + row.calls, 0);
}

test("the first workspace parts read registers one webhook for that document", async (t) => {
  const { registeredFor, state } = fakeOnshape(t);
  assert.equal((await readParts("first")).status, 200);
  assert.equal(registeredFor("first"), 1);
  const [{ body }] = state.registered;
  assert.equal(body.url, CALLBACK);
  assert.equal(body.isTransient, false);
  assert.ok(Array.isArray(body.events));
  assert.ok(
    (body.events as string[]).includes("onshape.model.lifecycle.changed")
  );

  await readParts("first");
  await readParts("first");
  assert.equal(registeredFor("first"), 1, "later reads don't register again");
  assert.equal(state.partsReads, 1);
});

test("a version read registers nothing", async (t) => {
  const { registeredFor } = fakeOnshape(t);
  assert.equal((await readParts("released-only", "v")).status, 200);
  assert.equal(registeredFor("released-only"), 0);
});

test("a failed registration doesn't fail the parts read and is retried by the next read", async (t) => {
  const { registeredFor, state } = fakeOnshape(t);
  state.failRegistration = true;
  assert.equal((await readParts("flaky")).status, 200);
  assert.equal(registeredFor("flaky"), 0);
  state.failRegistration = false;
  assert.equal((await readParts("flaky")).status, 200);
  assert.equal(registeredFor("flaky"), 1);
});

test("webhooks disabled: no registration, listing or deletion calls", async (t) => {
  delete process.env.ONSHAPE_WEBHOOK_SECRET;
  const { state } = fakeOnshape(t);
  await readParts("disabled");
  const stop = startOnshapeWebhookChecks(() => () => {});
  await onshapeWebhookWork();
  stop();
  assert.equal(state.registered.length, 0);
  assert.equal(state.listed, 0);
  assert.equal(state.deleted.length, 0);
  assert.deepEqual((await readUsage()).webhooks, { enabled: false });
});

test("the boot and daily checks re-register a dropped webhook exactly once", async (t) => {
  const { registeredFor, state } = fakeOnshape(t);
  await readParts("kept");
  await readParts("dropped");
  assert.equal(registeredFor("dropped"), 1);
  // Onshape drops webhooks without saying so.
  state.hooks = state.hooks.filter(
    (hook) => !hook.filter.includes("'dropped'")
  );

  let daily: (() => void) | undefined;
  let interval = 0;
  const stop = startOnshapeWebhookChecks((run, everyMs) => {
    daily = run;
    interval = everyMs;
    return () => (daily = undefined);
  });
  await onshapeWebhookWork();
  assert.equal(interval, 24 * 60 * 60 * 1000);
  assert.equal(registeredFor("dropped"), 2, "boot check re-registers it");
  assert.equal(registeredFor("kept"), 1);

  daily!();
  await onshapeWebhookWork();
  assert.equal(registeredFor("dropped"), 2, "a healthy webhook is left alone");
  assert.equal(state.listed, 2);
  stop();

  const { webhooks } = await readUsage();
  assert.equal(webhooks.enabled, true);
  assert.ok(webhooks.registered >= 2);
  assert.ok(Date.parse(webhooks.lastCheckedAt) > 0);
});

test("a check deletes strays pointing here and replaces webhooks with an old secret", async (t) => {
  const { registeredFor, state } = fakeOnshape(t);
  await readParts("rotated");
  const [rotated] = state.hooks.filter((hook) =>
    hook.filter.includes("'rotated'")
  );
  rotated.url = `${BASE}/api/onshape/webhook?secret=old`;
  state.hooks.push(
    { id: "stray", url: CALLBACK, filter: "{$DocumentId} = 'x'" },
    {
      id: "someone-else",
      url: "https://elsewhere.example.org/hook",
      filter: "{$DocumentId} = 'y'",
    }
  );
  const stop = startOnshapeWebhookChecks(() => () => {});
  await onshapeWebhookWork();
  stop();
  assert.ok(state.deleted.includes("stray"));
  assert.ok(state.deleted.includes(rotated.id));
  assert.ok(!state.deleted.includes("someone-else"));
  assert.equal(registeredFor("rotated"), 2);
  const replacement = state.hooks.find(
    (hook) => hook.filter.includes("'rotated'") && hook.id !== rotated.id
  );
  assert.equal(replacement?.url, CALLBACK);
});

test("registration, listing and deletion are tallied under their own labels", async (t) => {
  const before = await readUsage();
  const { state } = fakeOnshape(t);
  await readParts("tallied");
  state.hooks.push({ id: "stray-2", url: CALLBACK, filter: "" });
  const stop = startOnshapeWebhookChecks(() => () => {});
  await onshapeWebhookWork();
  stop();
  const usage = await readUsage();
  const delta = (label: string) =>
    callsFor(usage, label) - callsFor(before, label);
  assert.ok(delta("webhook-register") >= 1);
  assert.equal(delta("webhook-list"), 1);
  assert.ok(delta("webhook-delete") >= 1);
});

test("a delivery updates the last event time", async (t) => {
  fakeOnshape(t);
  await readParts("delivered");
  const before = new Date().toISOString();
  const url = new URL("http://localhost/api/onshape/webhook");
  url.searchParams.set("secret", SECRET);
  const request = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "onshape.model.lifecycle.changed",
      documentId: "delivered",
    }),
  });
  const response = await (
    webhookRoute as unknown as {
      POST: (context: { request: Request }) => Promise<Response>;
    }
  ).POST({ request });
  assert.equal(response.status, 200);
  const { webhooks } = await readUsage();
  assert.ok(webhooks.lastEventAt >= before, webhooks.lastEventAt);
});
