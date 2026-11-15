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

const dataDir = await mkdtemp(join(tmpdir(), "hawk-part-studio-freshness-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const { memoryOnshape } = await import("./onshape-memory-adapter");
const { endpoint } = await import("./http-fixture");
const actionsRoute = await import("../src/pages/api/mfg/parts/actions");
const partsRoute = await import("../src/pages/api/onshape/parts");
const webhookRoute = await import("../src/pages/api/onshape/webhook");
const { onshapeWebhookWork } = await import("../src/lib/onshapeApi/webhooks");

const SECRET = "freshness-secret";
const environmentKeys = [
  "ONSHAPE_CACHE_TTL_SECONDS",
  "ONSHAPE_MIN_REFRESH_SECONDS",
  "ONSHAPE_WEBHOOK_SECRET",
  "ONSHAPE_WEBHOOK_BASE_URL",
] as const;
const originalEnvironment = environmentKeys.map(
  (key) => [key, process.env[key]] as const
);

beforeEach(() => {
  delete process.env.ONSHAPE_CACHE_TTL_SECONDS;
  delete process.env.ONSHAPE_MIN_REFRESH_SECONDS;
  process.env.ONSHAPE_WEBHOOK_SECRET = SECRET;
  process.env.ONSHAPE_WEBHOOK_BASE_URL = "https://shop.example.org";
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// Each test starts on its own day so clocks never overlap between tests.
let nextStart = Date.parse("2026-11-01T12:00:00Z");

type Scope = {
  documentId: string;
  instanceType?: "w" | "v" | "m";
  elementId?: string;
};

/**
 * An in-memory Onshape with a mocked clock. Every parts read answers with a
 * fresh name, so a test can tell a cached answer from a new one.
 */
function onshape(t: TestContext) {
  const start = (nextStart += 7 * 86_400_000);
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const reads = new Map<string, number>();
  let value = "old";
  const upstream = memoryOnshape(t, async (request) => {
    const { pathname } = new URL(request.url);
    if (/\/webhooks$/.test(pathname)) return Response.json({ id: "hook" });
    const parts = /\/parts\/d\/([^/]+)\/([wvm])\/[^/]+\/e\/([^/]+)$/.exec(
      pathname
    );
    if (parts) {
      const key = `${parts[1]}/${parts[2]}/${parts[3]}`;
      const count = (reads.get(key) ?? 0) + 1;
      reads.set(key, count);
      return Response.json([
        {
          partId: "part",
          name: `${key} read ${count}`,
          partNumber: value,
          properties: [
            { name: "Part number", propertyId: "pn", value },
            { name: "Name", propertyId: "name", value: "Bracket" },
          ],
        },
        { partId: "other", name: "Other", partNumber: "untouched" },
      ]);
    }
    if (request.method === "POST") {
      const body = (await request.json()) as {
        properties: { value: string }[];
      };
      value = body.properties[0]!.value;
      return Response.json({});
    }
    return Response.json({
      properties: [{ name: "Part number", propertyId: "pn", value }],
    });
  });
  return {
    start,
    at: (offsetMs: number) => t.mock.timers.setTime(start + offsetMs),
    reads: ({ documentId, instanceType = "w", elementId = "studio" }: Scope) =>
      reads.get(`${documentId}/${instanceType}/${elementId}`) ?? 0,
    upstream,
  };
}

async function readParts({
  documentId,
  instanceType = "w",
  elementId = "studio",
}: Scope) {
  const query = new URLSearchParams({
    documentId,
    instanceType,
    instanceId: instanceType === "w" ? "workspace" : "fixed",
    elementId,
  });
  const request = new Request(
    `http://localhost/api/onshape/parts?${query}`,
    sessionRequest("student")
  );
  const response = await inRequest(request, () =>
    getHandler(partsRoute)({ request })
  );
  await onshapeWebhookWork();
  assert.equal(response.status, 200);
  return response.json();
}

async function deliver(body: Record<string, unknown>) {
  const url = new URL("http://localhost/api/onshape/webhook");
  url.searchParams.set("secret", SECRET);
  const request = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await (
    webhookRoute as unknown as {
      POST: (context: { request: Request }) => Promise<Response>;
    }
  ).POST({ request });
  assert.equal(response.status, 200);
}

const changed = (documentId: string, extra: Record<string, unknown> = {}) =>
  deliver({
    event: "onshape.model.lifecycle.changed",
    documentId,
    workspaceId: "workspace",
    webhookId: "hook",
    messageId: crypto.randomUUID(),
    ...extra,
  });

test("twenty edits in ten minutes cost one parts read per five-minute window", async (t) => {
  const clock = onshape(t);
  const scope = { documentId: "burst" };
  await readParts(scope);
  for (let edit = 1; edit <= 20; edit++) {
    clock.at(edit * 30_000);
    await changed("burst");
    await readParts(scope);
  }
  assert.equal(clock.reads(scope), 3, "the first read plus one per window");
});

test("edits to a document nobody is reading cost no Onshape calls", async (t) => {
  const clock = onshape(t);
  await readParts({ documentId: "idle" });
  for (let edit = 1; edit <= 50; edit++) {
    clock.at(edit * 60_000);
    await changed("idle");
  }
  assert.equal(clock.upstream.requests.length, 2, "one read, one registration");
});

test("an edit naming an element leaves the document's other Part Studios cached", async (t) => {
  const clock = onshape(t);
  const edited = { documentId: "scoped", elementId: "edited" };
  const untouched = { documentId: "scoped", elementId: "untouched" };
  await readParts(edited);
  await readParts(untouched);
  clock.at(600_000);
  await changed("scoped", { elementId: "edited" });
  await readParts(edited);
  await readParts(untouched);
  assert.equal(clock.reads(edited), 2);
  assert.equal(clock.reads(untouched), 1);
});

for (const [label, extra] of [
  ["no element", {}],
  ["an empty element", { elementId: "" }],
  ["the placeholder element", { elementId: "000000000000000000000000" }],
] as const) {
  const slug = label.replaceAll(" ", "-");
  test(`an edit naming ${label} marks every Part Studio of the document`, async (t) => {
    const clock = onshape(t);
    const first = { documentId: `whole-${slug}`, elementId: "first" };
    const second = { documentId: `whole-${slug}`, elementId: "second" };
    const elsewhere = { documentId: `other-${slug}` };
    for (const scope of [first, second, elsewhere]) await readParts(scope);
    clock.at(600_000);
    await changed(first.documentId, extra);
    for (const scope of [first, second, elsewhere]) await readParts(scope);
    assert.equal(clock.reads(first), 2);
    assert.equal(clock.reads(second), 2);
    assert.equal(clock.reads(elsewhere), 1, "other documents stay cached");
  });
}

for (const event of [
  "onshape.model.lifecycle.createversion",
  "onshape.model.lifecycle.metadata",
]) {
  test(`${event} follows the same mark-stale rule`, async (t) => {
    const clock = onshape(t);
    const scope = { documentId: event };
    await readParts(scope);
    clock.at(60_000);
    await deliver({ event, documentId: event });
    await readParts(scope);
    assert.equal(clock.reads(scope), 1, "younger than the window: reused");
    clock.at(300_000);
    await readParts(scope);
    assert.equal(clock.reads(scope), 2, "read again once the window passes");
  });
}

test("versions and microversions stay cached through any number of edits", async (t) => {
  const clock = onshape(t);
  const version = { documentId: "frozen", instanceType: "v" } as const;
  const microversion = { documentId: "frozen", instanceType: "m" } as const;
  await readParts(version);
  await readParts(microversion);
  for (let edit = 1; edit <= 5; edit++) {
    clock.at(edit * 86_400_000);
    await changed("frozen");
    await changed("frozen", { elementId: "studio" });
    await readParts(version);
    await readParts(microversion);
  }
  assert.equal(clock.reads(version), 1);
  assert.equal(clock.reads(microversion), 1);
});

test("ONSHAPE_MIN_REFRESH_SECONDS sets the refresh window", async (t) => {
  process.env.ONSHAPE_MIN_REFRESH_SECONDS = "900";
  const clock = onshape(t);
  const scope = { documentId: "slow-window" };
  await readParts(scope);
  clock.at(600_000);
  await changed("slow-window");
  await readParts(scope);
  assert.equal(
    clock.reads(scope),
    1,
    "ten minutes is inside a 15-minute window"
  );
  clock.at(899_999);
  await readParts(scope);
  assert.equal(clock.reads(scope), 1);
  clock.at(900_000);
  await readParts(scope);
  assert.equal(clock.reads(scope), 2);
});

for (const value of ["", "0", "-5", "1.5", "abc", "Infinity"]) {
  test(`invalid ONSHAPE_MIN_REFRESH_SECONDS ${JSON.stringify(value)} keeps five minutes`, async (t) => {
    process.env.ONSHAPE_MIN_REFRESH_SECONDS = value;
    const clock = onshape(t);
    const scope = { documentId: `bad-window-${value}` };
    await readParts(scope);
    clock.at(60_000);
    await changed(scope.documentId);
    clock.at(299_999);
    await readParts(scope);
    assert.equal(clock.reads(scope), 1);
    clock.at(300_000);
    await readParts(scope);
    assert.equal(clock.reads(scope), 2);
  });
}

test("a shorter explicit TTL is never extended by an edit", async (t) => {
  process.env.ONSHAPE_CACHE_TTL_SECONDS = "120";
  const clock = onshape(t);
  const scope = { documentId: "short-ttl" };
  await readParts(scope);
  clock.at(60_000);
  await changed("short-ttl");
  clock.at(120_000);
  await readParts(scope);
  assert.equal(clock.reads(scope), 2, "expired at its own TTL, not the window");
});

async function editPartNumber(
  { documentId, instanceType = "w", elementId = "studio" }: Scope,
  partNumber: string
) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    documentId,
    instanceType,
    instanceId: instanceType === "w" ? "workspace" : "fixed",
    elementId,
    partId: "part",
    partNumber,
  }))
    form.set(key, value);
  const response = await endpoint(
    actionsRoute as never,
    "POST"
  )(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: sessionRequest("student").headers,
      body: form,
    })
  );
  return response.json();
}

test("a part-number edit shows on the next parts read without another Onshape read", async (t) => {
  const clock = onshape(t);
  const scope = { documentId: "numbered" };
  await readParts(scope);
  const before = clock.upstream.requests.length;
  assert.deepEqual(await editPartNumber(scope, "RHR-0042"), { success: true });
  assert.equal(
    clock.upstream.requests.length - before,
    3,
    "discovery, write and verification only"
  );
  const [part, other] = await readParts(scope);
  assert.equal(part.partNumber, "RHR-0042");
  assert.deepEqual(
    part.properties.map((property: { value: string }) => property.value),
    ["RHR-0042", "Bracket"]
  );
  assert.equal(other.partNumber, "untouched");
  assert.equal(clock.reads(scope), 1);
});

test("a part-number edit counts as a fresh observation of the cached read", async (t) => {
  const clock = onshape(t);
  const scope = { documentId: "renumbered" };
  await readParts(scope);
  clock.at(600_000);
  await changed("renumbered");
  await editPartNumber(scope, "RHR-0043");
  assert.equal((await readParts(scope))[0].partNumber, "RHR-0043");
  assert.equal(clock.reads(scope), 1, "the edit refreshed the fetch time");
  clock.at(600_000 + 60_000);
  await changed("renumbered");
  await readParts(scope);
  assert.equal(clock.reads(scope), 1, "a later edit floors from the write");
});

test("a part-number edit with nothing cached fetches nothing", async (t) => {
  const clock = onshape(t);
  const scope = { documentId: "uncached" };
  assert.deepEqual(await editPartNumber(scope, "RHR-0044"), { success: true });
  assert.equal(clock.upstream.requests.length, 3);
  assert.equal(clock.reads(scope), 0);
  assert.equal((await readParts(scope))[0].partNumber, "RHR-0044");
  assert.equal(clock.reads(scope), 1);
});
