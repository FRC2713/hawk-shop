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

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-workspace-ttl-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const partsRoute = await import("../src/pages/api/onshape/parts");
const { onshapeWebhookWork } = await import("../src/lib/onshapeApi/webhooks");

const environmentKeys = [
  "ONSHAPE_CACHE_TTL_SECONDS",
  "ONSHAPE_WEBHOOK_SECRET",
  "ONSHAPE_WEBHOOK_BASE_URL",
] as const;
const originalEnvironment = environmentKeys.map(
  (key) => [key, process.env[key]] as const
);

beforeEach(() => {
  delete process.env.ONSHAPE_CACHE_TTL_SECONDS;
  process.env.ONSHAPE_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.ONSHAPE_WEBHOOK_BASE_URL = "https://shop.example.org";
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const start = Date.parse("2026-11-09T12:00:00Z");

/** Mock only the external transport and clock; route and SQLite cache stay real. */
function mockOnshape(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date"], now: start });
  const calls = { parts: 0, registrations: 0 };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const { pathname } = new URL(request.url);
      if (
        /^\/api\/v\d+\/webhooks$/.test(pathname) &&
        request.method === "POST"
      ) {
        calls.registrations++;
        return Response.json({ id: "hook" });
      }
      assert.match(pathname, /\/parts\/d\/[^/]+\/[wvm]\//);
      assert.equal(request.method, "GET");
      calls.parts++;
      return Response.json([{ partId: "part", name: `Read ${calls.parts}` }]);
    }
  );
  return calls;
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
  assert.equal(response.status, 200);
  return response.json();
}

test("configured webhooks keep workspace reads cached until exactly 24 hours", async (t) => {
  const calls = mockOnshape(t);
  assert.deepEqual(await readParts("configured"), [
    { partId: "part", name: "Read 1" },
  ]);
  t.mock.timers.setTime(start + 300_000);
  await readParts("configured");
  assert.equal(calls.parts, 1, "five minutes no longer expires the workspace");
  t.mock.timers.setTime(start + 86_399_999);
  assert.deepEqual(await readParts("configured"), [
    { partId: "part", name: "Read 1" },
  ]);
  assert.equal(calls.parts, 1);
  t.mock.timers.setTime(start + 86_400_000);
  assert.deepEqual(await readParts("configured"), [
    { partId: "part", name: "Read 2" },
  ]);
  await readParts("configured");
  assert.equal(
    calls.parts,
    2,
    "the expired entry is fetched once and cached again"
  );
  assert.equal(calls.registrations, 1);
});

for (const [label, secret, baseUrl] of [
  ["missing secret", undefined, "https://shop.example.org"],
  ["missing base URL", "secret", undefined],
  ["blank secret", "   ", "https://shop.example.org"],
  ["blank base URL", "secret", "   "],
  ["invalid base URL", "secret", "not-a-url"],
  ["unsupported protocol", "secret", "ftp://shop.example.org"],
] as const) {
  test(`${label} keeps the workspace default at five minutes`, async (t) => {
    if (secret === undefined) delete process.env.ONSHAPE_WEBHOOK_SECRET;
    else process.env.ONSHAPE_WEBHOOK_SECRET = secret;
    if (baseUrl === undefined) delete process.env.ONSHAPE_WEBHOOK_BASE_URL;
    else process.env.ONSHAPE_WEBHOOK_BASE_URL = baseUrl;
    const calls = mockOnshape(t);
    await readParts(label);
    t.mock.timers.setTime(start + 299_999);
    await readParts(label);
    assert.equal(calls.parts, 1);
    t.mock.timers.setTime(start + 300_000);
    assert.deepEqual(await readParts(label), [
      { partId: "part", name: "Read 2" },
    ]);
    assert.equal(calls.parts, 2);
    assert.equal(calls.registrations, 0);
  });
}

for (const configured of [true, false]) {
  for (const seconds of [0.5, 60, 90_000]) {
    test(`explicit ${seconds}s TTL overrides the default with webhooks ${configured ? "configured" : "disabled"}`, async (t) => {
      if (!configured) delete process.env.ONSHAPE_WEBHOOK_SECRET;
      process.env.ONSHAPE_CACHE_TTL_SECONDS = String(seconds);
      const calls = mockOnshape(t);
      const documentId = `override-${configured}-${seconds}`;
      await readParts(documentId);
      t.mock.timers.setTime(start + seconds * 1000 - 1);
      await readParts(documentId);
      assert.equal(calls.parts, 1);
      t.mock.timers.setTime(start + seconds * 1000);
      assert.deepEqual(await readParts(documentId), [
        { partId: "part", name: "Read 2" },
      ]);
      assert.equal(calls.parts, 2);
    });
  }

  for (const value of ["", "   ", "0", "-1", "invalid", "Infinity", "NaN"]) {
    test(`invalid TTL ${JSON.stringify(value)} uses the ${configured ? "24-hour" : "five-minute"} default`, async (t) => {
      if (!configured) delete process.env.ONSHAPE_WEBHOOK_SECRET;
      process.env.ONSHAPE_CACHE_TTL_SECONDS = value;
      const calls = mockOnshape(t);
      const documentId = `invalid-ttl-${configured}-${value}`;
      const expiry = configured ? 86_400_000 : 300_000;
      await readParts(documentId);
      t.mock.timers.setTime(start + expiry - 1);
      await readParts(documentId);
      assert.equal(calls.parts, 1);
      t.mock.timers.setTime(start + expiry);
      await readParts(documentId);
      assert.equal(calls.parts, 2);
    });
  }

  test(`versions and microversions never expire with webhooks ${configured ? "configured" : "disabled"}`, async (t) => {
    if (!configured) delete process.env.ONSHAPE_WEBHOOK_SECRET;
    process.env.ONSHAPE_CACHE_TTL_SECONDS = "1";
    const calls = mockOnshape(t);
    const documentId = `immutable-${configured}`;
    await readParts(documentId, "v");
    await readParts(documentId, "m");
    t.mock.timers.setTime(start + 30 * 86_400_000);
    assert.deepEqual(await readParts(documentId, "v"), [
      { partId: "part", name: "Read 1" },
    ]);
    assert.deepEqual(await readParts(documentId, "m"), [
      { partId: "part", name: "Read 2" },
    ]);
    assert.equal(calls.parts, 2);
    assert.equal(calls.registrations, 0);
  });
}
