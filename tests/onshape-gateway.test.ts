import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-gateway-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const { memoryOnshape } = await import("./onshape-memory-adapter");
const gateway = await import("../src/lib/onshapeApi/gateway");
const { OnshapeRequestError } = await import("../src/lib/onshapeApi/auth");
const usage = await import("../src/pages/api/onshape/usage");

type UsageRow = { day: string; label: string; calls: number; hits: number };

async function usageBody() {
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

async function tally(label: string) {
  const { byDay } = await usageBody();
  const row = byDay.find((row: UsageRow) => row.label === label);
  return row ? { calls: row.calls, hits: row.hits } : { calls: 0, hits: 0 };
}

test("a cached read reaches Onshape once and answers repeats from the cache", async (t) => {
  const onshape = memoryOnshape(t, () => Response.json({ name: "V1" }));
  const read = () =>
    gateway.onshapeRead<{ name: string }>({
      label: "version",
      cache: { key: "version::doc::v1", ttlMs: 60_000 },
      request: { path: "/v12/documents/d/doc/versions/v1" },
    });
  assert.deepEqual(await read(), { name: "V1" });
  assert.deepEqual(await read(), { name: "V1" });
  assert.deepEqual(onshape.paths(), ["/api/v12/documents/d/doc/versions/v1"]);
  assert.deepEqual(await tally("version"), { calls: 1, hits: 1 });
});

test("concurrent uncached binary reads with one dedup key share one call", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const onshape = memoryOnshape(t, async () => {
    await gate;
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });
  });
  const read = () =>
    gateway.onshapeRead({
      label: "thumbnail",
      dedupKey: "thumbnail::shared",
      responseType: "binary",
      request: { path: "https://cad.onshape.com/api/thumbnails/abc/s/300x300" },
    });
  const reads = Array.from({ length: 10 }, read);
  release();
  for (const image of await Promise.all(reads)) {
    assert.deepEqual([...image.bytes], [1, 2, 3]);
    assert.equal(image.contentType, "image/png");
  }
  assert.equal(onshape.requests.length, 1);
  assert.deepEqual(await tally("thumbnail"), { calls: 1, hits: 9 });

  await read();
  assert.equal(onshape.requests.length, 2, "an uncached read is not stored");
});

test("a failed response is neither cached nor counted", async (t) => {
  let status = 401;
  const onshape = memoryOnshape(t, () =>
    status === 200
      ? Response.json([{ partId: "p" }])
      : Response.json({ message: "Unauthenticated API request" }, { status })
  );
  const read = () =>
    gateway.onshapeRead({
      label: "parts",
      cache: { key: "parts::failing::w::ws::e", ttlMs: 60_000 },
      request: { path: "/v12/parts/d/failing/w/ws/e/e" },
    });
  await assert.rejects(read, (error: unknown) => {
    assert.ok(error instanceof OnshapeRequestError);
    assert.equal(error.status, 401);
    assert.match(error.message, /Unauthenticated API request/);
    return true;
  });
  assert.deepEqual(await tally("parts"), { calls: 0, hits: 0 });

  status = 200;
  assert.deepEqual(await read(), [{ partId: "p" }]);
  assert.equal(onshape.requests.length, 2, "the failure was not cached");
  assert.deepEqual(await tally("parts"), { calls: 1, hits: 0 });
});

test("a 402 reads as the allocation used up and is not counted", async (t) => {
  memoryOnshape(t, () => Response.json({}, { status: 402 }));
  await assert.rejects(
    gateway.onshapeWrite({
      label: "metadata-write",
      request: { path: "/v12/metadata/d/doc/w/ws/e/e/p/part", body: {} },
    }),
    { message: "Onshape API allocation used up." }
  );
  assert.deepEqual(await tally("metadata-write"), { calls: 0, hits: 0 });
});

test("a read that rides along on a failed request is not counted", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  memoryOnshape(t, async () => {
    await gate;
    return Response.json({ message: "Not found" }, { status: 404 });
  });
  const read = () =>
    gateway.onshapeRead({
      label: "webhook-list",
      dedupKey: "webhook-list::failing",
      request: { path: "/v12/webhooks" },
    });
  const reads = [read(), read()];
  release();
  for (const outcome of await Promise.allSettled(reads))
    assert.equal(outcome.status, "rejected");
  assert.deepEqual(await tally("webhook-list"), { calls: 0, hits: 0 });
});

test("a read that opts out of single-flight always makes its own call", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const onshape = memoryOnshape(t, async () => {
    await gate;
    return Response.json({ properties: [] });
  });
  const read = () =>
    gateway.onshapeRead({
      label: "metadata-read",
      singleFlight: false,
      request: { path: "/v12/metadata/d/doc/w/ws/e/e/p/part" },
    });
  const reads = [read(), read()];
  release();
  await Promise.all(reads);
  assert.equal(onshape.requests.length, 2);
  assert.deepEqual(await tally("metadata-read"), { calls: 2, hits: 0 });
});
