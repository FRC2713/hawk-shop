import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-remaining-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const parts = await import("../src/pages/api/onshape/parts");
const usage = await import("../src/pages/api/onshape/usage");

type Remaining = {
  value: number | null;
  observedAt: string;
  lastStatus: number;
} | null;

async function readUsage() {
  const request = new Request(
    "http://localhost/api/onshape/usage",
    sessionRequest("mentor")
  );
  const response = await inRequest(request, () =>
    getHandler(usage)({ request })
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function readParts(documentId: string, instanceType = "w") {
  const request = new Request(
    `http://localhost/api/onshape/parts?${new URLSearchParams({
      documentId,
      instanceType,
      instanceId: "instance",
      elementId: "studio",
    })}`,
    sessionRequest("mentor")
  );
  return inRequest(request, () => getHandler(parts)({ request }));
}

function upstream(
  t: { mock: { method: Function } },
  respond: () => Response
): { calls: number } {
  const counter = { calls: 0 };
  t.mock.method(globalThis, "fetch", async () => {
    counter.calls++;
    return respond();
  });
  return counter;
}

const partsWith = (headers: Record<string, string>, status = 200) =>
  Response.json(status === 200 ? [] : { message: "Upstream said no" }, {
    status,
    headers,
  });

test("before any Onshape response, usage reports no remaining count and keeps its shape", async () => {
  const body = await readUsage();
  assert.equal(body.remaining, null);
  assert.deepEqual(Object.keys(body.totals).sort(), [
    "attempted",
    "calls",
    "hitRate",
    "hits",
  ]);
  assert.ok(Array.isArray(body.byDay));
});

test("the remaining-calls header on an Onshape response shows up in usage", async (t) => {
  upstream(t, () => partsWith({ "x-rate-limit-remaining": "4321" }));
  const before = Date.now();
  assert.equal((await readParts("header-present")).status, 200);
  const remaining: Remaining = (await readUsage()).remaining;
  assert.equal(remaining?.value, 4321);
  assert.equal(remaining?.lastStatus, 200);
  assert.ok(Date.parse(remaining!.observedAt) >= before - 1000);
});

test("a missing or malformed header keeps the previous value and the read still succeeds", async (t) => {
  const before: Remaining = (await readUsage()).remaining;
  assert.equal(before?.value, 4321);
  for (const [index, raw] of [
    undefined,
    "",
    "plenty",
    "-5",
    "1.5",
    "12abc",
  ].entries()) {
    t.mock.restoreAll();
    upstream(t, () =>
      partsWith(raw === undefined ? {} : { "x-rate-limit-remaining": raw })
    );
    assert.equal((await readParts(`malformed-${index}`)).status, 200);
    const after: Remaining = (await readUsage()).remaining;
    assert.deepEqual(after, before, `header ${JSON.stringify(raw)}`);
  }
});

test("a cache hit makes no upstream call and leaves the stored value alone", async (t) => {
  const counter = upstream(t, () =>
    partsWith({ "x-rate-limit-remaining": "900" })
  );
  assert.equal((await readParts("cached", "v")).status, 200);
  assert.equal(counter.calls, 1);
  const first: Remaining = (await readUsage()).remaining;
  assert.equal(first?.value, 900);
  t.mock.restoreAll();
  const silent = upstream(t, () =>
    partsWith({ "x-rate-limit-remaining": "1" })
  );
  assert.equal((await readParts("cached", "v")).status, 200);
  assert.equal(silent.calls, 0);
  assert.deepEqual((await readUsage()).remaining, first);
});

test("each endpoint family keeps its own count; the latest observed leads", async (t) => {
  upstream(t, () =>
    Response.json(
      { properties: [] },
      { headers: { "x-rate-limit-remaining": "3000" } }
    )
  );
  const { onshapeApiRequest } = await import("../src/lib/onshapeApi/auth");
  await onshapeApiRequest("/v6/users/sessioninfo");
  const body = await readUsage();
  assert.deepEqual(
    { label: body.remaining.label, value: body.remaining.value },
    { label: "users", value: 3000 }
  );
  const byLabel = Object.fromEntries(
    body.remainingByLabel.map((row: { label: string; value: number }) => [
      row.label,
      row.value,
    ])
  );
  assert.deepEqual(byLabel, { users: 3000, parts: 900 });
});

test("a 402 is recorded and the parts route reports the allocation used up", async (t) => {
  upstream(t, () => partsWith({ "x-rate-limit-remaining": "0" }, 402));
  const response = await readParts("exhausted");
  assert.equal(response.status, 402);
  assert.match((await response.json()).error, /allocation used up/i);
  const remaining: Remaining = (await readUsage()).remaining;
  assert.equal(remaining?.lastStatus, 402);
  assert.equal(remaining?.value, 0);

  t.mock.restoreAll();
  upstream(t, () => partsWith({}, 402));
  assert.equal((await readParts("exhausted-no-header")).status, 402);
  const kept: Remaining = (await readUsage()).remaining;
  assert.equal(kept?.lastStatus, 402);
  assert.equal(kept?.value, 0);
});

test("the stored count survives reopening the same DATA_DIR", async () => {
  const { spawnSync } = await import("node:child_process");
  const script = `
  const { getHandler, inRequest, sessionRequest } = await import('./tests/request-context.ts');
  const usage = await import('./src/pages/api/onshape/usage.ts');
  globalThis.fetch = async () => { throw new Error('no upstream'); };
  const request = new Request('http://localhost/api/onshape/usage', sessionRequest('mentor'));
  const response = await inRequest(request, () => getHandler(usage)({ request }));
  console.log(JSON.stringify(await response.json()));
  `;
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/register-server-only.mjs",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: "utf8",
    }
  );
  assert.equal(child.status, 0, child.stderr);
  const body = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  assert.deepEqual(body.remaining, (await readUsage()).remaining);
  assert.equal(body.remaining.lastStatus, 402);
});
