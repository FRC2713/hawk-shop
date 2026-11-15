import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, test, type TestContext } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-ceiling-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const { memoryOnshape } = await import("./onshape-memory-adapter");
const gateway = await import("../src/lib/onshapeApi/gateway");
const partsRoute = await import("../src/pages/api/onshape/parts");
const versionRoute = await import("../src/pages/api/onshape/version");
const usageRoute = await import("../src/pages/api/onshape/usage");

const originalLimit = process.env.ONSHAPE_DAILY_CALL_LIMIT;
const originalTtl = process.env.ONSHAPE_CACHE_TTL_SECONDS;
afterEach(() => {
  for (const [key, value] of [
    ["ONSHAPE_DAILY_CALL_LIMIT", originalLimit],
    ["ONSHAPE_CACHE_TTL_SECONDS", originalTtl],
  ] as const)
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

// Each test runs on its own UTC day, so today's tally starts at zero.
let nextDay = Date.parse("2026-11-01T12:00:00Z");
function freshDay(t: TestContext) {
  const now = (nextDay += 7 * 86_400_000);
  t.mock.timers.enable({ apis: ["Date"], now });
  return now;
}

async function get(module: object, path: string) {
  const request = new Request(
    `http://localhost${path}`,
    sessionRequest("student")
  );
  return inRequest(request, () => getHandler(module)({ request }));
}

const parts = (documentId: string, instanceType = "v") =>
  get(
    partsRoute,
    `/api/onshape/parts?${new URLSearchParams({ documentId, instanceType, instanceId: "instance", elementId: "studio" })}`
  );
const version = (documentId: string, versionId: string) =>
  get(
    versionRoute,
    `/api/onshape/version?documentId=${documentId}&versionId=${versionId}`
  );
const budget = async () =>
  (await (await get(usageRoute, "/api/onshape/usage")).json()).budget;

/** Onshape that answers parts and version reads, numbering each answer. */
function cad(t: TestContext) {
  let served = 0;
  return memoryOnshape(t, (request) => {
    served++;
    const { pathname } = new URL(request.url);
    if (pathname.includes("/versions/"))
      return Response.json({ id: "v", name: `Version ${served}` });
    assert.match(
      pathname,
      /^\/api\/v12\/parts\/d\/[^/]+\/[wvm]\/instance\/e\/studio$/
    );
    return Response.json([{ partId: "part", name: `Read ${served}` }]);
  });
}

test("with no ceiling configured, reads keep reaching Onshape", async (t) => {
  freshDay(t);
  for (const raw of [undefined, "", "0", "-3", "2.5", "lots"]) {
    if (raw === undefined) delete process.env.ONSHAPE_DAILY_CALL_LIMIT;
    else process.env.ONSHAPE_DAILY_CALL_LIMIT = raw;
    assert.deepEqual(gateway.onshapeDailyCallLimit(), null, String(raw));
  }
  const onshape = cad(t);
  for (const id of ["a", "b", "c"])
    assert.equal((await version("unlimited", id)).status, 200);
  assert.equal(onshape.requests.length, 3);
  assert.deepEqual(await budget(), { limit: null, today: 3, reached: false });
});

test("the parts and version reads go through the gateway with their labels", async (t) => {
  freshDay(t);
  const onshape = cad(t);
  assert.equal((await parts("labelled")).status, 200);
  assert.equal((await parts("labelled")).status, 200);
  assert.equal((await version("labelled", "v1")).status, 200);
  assert.equal(onshape.requests.length, 2);
  const query = new URL(onshape.requests[0].url).searchParams;
  assert.equal(query.get("withThumbnails"), "true");
  assert.equal(query.get("includePropertyDefaults"), "true");
  const today = new Date().toISOString().slice(0, 10);
  const { byDay } = await (await get(usageRoute, "/api/onshape/usage")).json();
  const rows = byDay
    .filter((row: { day: string }) => row.day === today)
    .map(({ label, calls, hits }: Record<string, unknown>) => ({
      label,
      calls,
      hits,
    }))
    .sort((a: { label: string }, b: { label: string }) =>
      a.label.localeCompare(b.label)
    );
  assert.deepEqual(rows, [
    { label: "parts", calls: 1, hits: 1 },
    { label: "version", calls: 1, hits: 0 },
  ]);
});

test("once the ceiling is reached, an expired cached read is served stale", async (t) => {
  const start = freshDay(t);
  process.env.ONSHAPE_DAILY_CALL_LIMIT = "2";
  process.env.ONSHAPE_CACHE_TTL_SECONDS = "60";
  const onshape = cad(t);
  assert.deepEqual(await (await parts("stale", "w")).json(), [
    { partId: "part", name: "Read 1" },
  ]);
  assert.equal((await version("stale", "v1")).status, 200);
  assert.deepEqual(await budget(), { limit: 2, today: 2, reached: true });

  t.mock.timers.setTime(start + 61_000);
  const response = await parts("stale", "w");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ partId: "part", name: "Read 1" }]);
  assert.equal(onshape.requests.length, 2, "no call past the ceiling");
});

test("once the ceiling is reached, a read with nothing cached answers 503", async (t) => {
  freshDay(t);
  process.env.ONSHAPE_DAILY_CALL_LIMIT = "1";
  const onshape = cad(t);
  assert.equal((await version("empty", "v1")).status, 200);

  for (const response of [await version("empty", "v2"), await parts("empty")]) {
    assert.equal(response.status, 503);
    assert.match(
      (await response.json()).error,
      /^Daily Onshape budget reached/
    );
  }
  assert.equal(onshape.requests.length, 1);

  delete process.env.ONSHAPE_DAILY_CALL_LIMIT;
  assert.equal(
    (await version("empty", "v2")).status,
    200,
    "lifting it resumes"
  );
});

test("a write is refused at the ceiling, but an operation admitted before it finishes", async (t) => {
  freshDay(t);
  process.env.ONSHAPE_DAILY_CALL_LIMIT = "1";
  const onshape = memoryOnshape(t);
  const write = () =>
    gateway.onshapeWrite({
      label: "metadata-write",
      request: { path: "/v12/metadata/d/doc/w/ws/e/e/p/part", body: {} },
    });

  const result = await gateway.onshapeOperation(async () => {
    await gateway.onshapeRead({
      label: "metadata-read",
      dedupKey: "metadata::discovery",
      request: { path: "/v12/documents/d/doc/versions/discovery" },
    });
    assert.equal((await budget()).reached, true, "crossed part-way");
    await write();
    return "finished";
  });
  assert.equal(result, "finished");
  assert.equal(onshape.requests.length, 2);

  await assert.rejects(write, gateway.OnshapeDailyBudgetError);
  await assert.rejects(
    gateway.onshapeOperation(async () => "never"),
    gateway.OnshapeDailyBudgetError
  );
  assert.equal(onshape.requests.length, 2);
});
