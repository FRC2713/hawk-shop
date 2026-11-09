import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-allocation-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const version = await import("../src/pages/api/onshape/version");
const thumbnail = await import("../src/pages/api/onshape/thumbnail");
const usage = await import("../src/pages/api/onshape/usage");
const { handlePartNumberUpdate } =
  await import("../src/onshape_connector/actions/partNumberUpdate");
const { onshapeApiRequest } = await import("../src/lib/onshapeApi/auth");

type Remaining = {
  label: string;
  value: number | null;
  observedAt: string;
  lastStatus: number;
};

async function route(module: object, path: string) {
  const request = new Request(
    `http://localhost${path}`,
    sessionRequest("mentor")
  );
  return inRequest(request, () => getHandler(module)({ request }));
}

async function remainingFor(label: string): Promise<Remaining | undefined> {
  const response = await route(usage, "/api/onshape/usage");
  const body = await response.json();
  return body.remainingByLabel.find((row: Remaining) => row.label === label);
}

function upstream(
  t: { mock: { method: Function } },
  respond: (request: Request) => Response
) {
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(input instanceof Request ? input : new Request(input, init))
  );
}

const exhausted = () =>
  Response.json({ message: "Payment required" }, { status: 402 });

test("the version route reports a 402 as the allocation used up", async (t) => {
  upstream(t, exhausted);
  const response = await route(
    version,
    "/api/onshape/version?documentId=doc&versionId=spent"
  );
  assert.equal(response.status, 402);
  assert.equal(
    (await response.json()).error,
    "Onshape API allocation used up."
  );
});

test("the thumbnail route reports a 402 as the allocation used up", async (t) => {
  upstream(t, exhausted);
  const response = await route(
    thumbnail,
    `/api/onshape/thumbnail?url=${encodeURIComponent("https://cad.onshape.com/api/thumbnails/spent")}`
  );
  assert.equal(response.status, 402);
  assert.equal(
    (await response.json()).error,
    "Onshape API allocation used up."
  );
});

test("a part-number release answers a 402 inline with the same message", async (t) => {
  upstream(t, exhausted);
  const data = new FormData();
  for (const [key, value] of Object.entries({
    partId: "part",
    partNumber: "2713",
    documentId: "doc",
    instanceType: "w",
    instanceId: "workspace",
    elementId: "studio",
  }))
    data.set(key, value);
  const request = sessionRequest("editor");
  const response = await inRequest(request, async () =>
    Response.json(await handlePartNumberUpdate(data, request))
  );
  assert.deepEqual(await response.json(), {
    success: false,
    error: "Onshape API allocation used up.",
  });
});

test("a redirect records only the final response's header, not each hop", async (t) => {
  upstream(t, (request) =>
    request.url.includes("/assemblies/")
      ? new Response(null, {
          status: 307,
          headers: {
            location: "https://cad.onshape.com/api/v12/elements/final",
            "x-rate-limit-remaining": "111",
          },
        })
      : Response.json({}, { headers: { "x-rate-limit-remaining": "222" } })
  );
  await onshapeApiRequest("/v12/assemblies/hop");
  assert.equal(await remainingFor("assemblies"), undefined);
  assert.equal((await remainingFor("elements"))?.value, 222);
});

test("after a 402, a later response without a valid header clears the used-up state and keeps the value", async (t) => {
  upstream(t, () =>
    Response.json(
      {},
      { status: 402, headers: { "x-rate-limit-remaining": "7" } }
    )
  );
  await onshapeApiRequest("/v12/featurestudios/spent");
  const spent = await remainingFor("featurestudios");
  assert.deepEqual([spent?.value, spent?.lastStatus], [7, 402]);

  t.mock.restoreAll();
  upstream(t, () =>
    Response.json({}, { headers: { "x-rate-limit-remaining": "lots" } })
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await onshapeApiRequest("/v12/featurestudios/recovered");
  const recovered = await remainingFor("featurestudios");
  assert.deepEqual([recovered?.value, recovered?.lastStatus], [7, 200]);
  assert.ok(recovered!.observedAt > spent!.observedAt);

  t.mock.restoreAll();
  upstream(t, () => Response.json({}, { status: 404 }));
  await onshapeApiRequest("/v12/featurestudios/missing");
  const later = await remainingFor("featurestudios");
  assert.deepEqual(later, recovered, "only a 402 is replaced without a header");
});

test("ONSHAPE_REMAINING_WARN_AT sets the low-count threshold; an invalid value means 1000", async (t) => {
  const { onshapeRemainingStatus } =
    await import("../src/lib/onshapeApi/remaining");
  const observedAt = "2026-11-09T12:00:00.000Z";
  const rows = [
    { label: "parts", value: 250, observedAt, lastStatus: 200 },
    { label: "users", value: 900, observedAt, lastStatus: 200 },
    { label: "thumbnails", value: 0, observedAt, lastStatus: 402 },
  ];
  const original = process.env.ONSHAPE_REMAINING_WARN_AT;
  t.after(() => {
    if (original === undefined) delete process.env.ONSHAPE_REMAINING_WARN_AT;
    else process.env.ONSHAPE_REMAINING_WARN_AT = original;
  });
  const lowAt = (raw: string | undefined) => {
    if (raw === undefined) delete process.env.ONSHAPE_REMAINING_WARN_AT;
    else process.env.ONSHAPE_REMAINING_WARN_AT = raw;
    const status = onshapeRemainingStatus(rows);
    return [status.warnAt, status.low.map((row) => row.label)];
  };
  assert.deepEqual(lowAt(undefined), [1000, ["parts", "users"]]);
  assert.deepEqual(lowAt("300"), [300, ["parts"]]);
  assert.deepEqual(lowAt("100"), [100, []]);
  for (const invalid of ["", "lots", "-5", "1.5"])
    assert.deepEqual(lowAt(invalid), [1000, ["parts", "users"]], invalid);
  assert.deepEqual(
    onshapeRemainingStatus(rows).exhausted.map((row) => row.label),
    ["thumbnails"]
  );
});
