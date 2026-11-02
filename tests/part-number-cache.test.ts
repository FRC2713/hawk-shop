import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inRequest, sessionRequest, getHandler } from "./request-context";
const dataDir = await mkdtemp(join(tmpdir(), "hawk-cache-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));
const { handlePartNumberUpdate } =
  await import("../app/onshape_connector/actions/partNumberUpdate");
const { Route: partsRoute } = await import("../app/routes/api/onshape/parts");
const scope = {
  documentId: "doc",
  instanceType: "v",
  instanceId: "version",
  elementId: "studio",
};
async function read(documentId: string) {
  const request = new Request(
    `http://localhost/api/onshape/parts?${new URLSearchParams({ ...scope, documentId })}`,
    sessionRequest("editor")
  );
  const response = await inRequest(request, () =>
    getHandler(partsRoute)({ request })
  );
  assert.equal(response.status, 200);
  return response.json();
}
async function edit(documentId: string) {
  const form = new FormData();
  Object.entries({
    ...scope,
    documentId,
    partId: "part",
    partNumber: "new",
  }).forEach(([k, v]) => form.set(k, v));
  const request = sessionRequest("editor");
  return (
    await inRequest(request, async () =>
      Response.json(await handlePartNumberUpdate(form, request))
    )
  ).json();
}
const metadata = (value: string) => ({
  properties: [{ name: "Part number", propertyId: "pn", value }],
});

test("confirmed edit refreshes ordinary parts reads while unrelated immutable scopes stay cached", async (t) => {
  let value = "old";
  let reads = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.url.includes("/parts/")) {
        reads++;
        return Response.json([{ partId: "part", partNumber: value }]);
      }
      if (request.method === "POST") {
        value = "new";
        return Response.json({});
      }
      return Response.json(metadata(value));
    }
  );
  await read("confirmed");
  await read("unrelated");
  assert.deepEqual(await edit("confirmed"), { success: true });
  assert.equal((await read("confirmed"))[0].partNumber, "new");
  assert.equal((await read("unrelated"))[0].partNumber, "old");
  assert.equal(reads, 3);
});

test("accepted but unconfirmed edits evict old parts before verification finishes", async (t) => {
  for (const failure of ["mismatch", "transport"] as const) {
    const documentId = `unconfirmed-${failure}`;
    let saved = false;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        if (request.url.includes("/parts/"))
          return Response.json([{ partNumber: saved ? "new" : "old" }]);
        if (request.method === "POST") {
          saved = true;
          return Response.json({});
        }
        if (saved) {
          assert.equal((await read(documentId))[0].partNumber, "new");
          if (failure === "transport")
            throw new Error("Verification disconnected");
        }
        return Response.json(metadata("old"));
      }
    );
    await read(documentId);
    const result = await edit(documentId);
    assert.equal(result.success, false);
    assert.match(result.error, /could not be confirmed/);
    assert.equal((await read(documentId))[0].partNumber, "new");
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("a pre-edit read cannot be reused, restore stale parts, or delete a replacement flight", async (t) => {
  const oldStarted = deferred<void>();
  const oldResult = deferred<Response>();
  const freshStarted = deferred<void>();
  const freshResult = deferred<Response>();
  let saved = false;
  let reads = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.url.includes("/parts/")) {
        reads++;
        if (reads === 1) {
          oldStarted.resolve();
          return oldResult.promise;
        }
        freshStarted.resolve();
        return freshResult.promise;
      }
      if (request.method === "POST") {
        saved = true;
        return Response.json({});
      }
      return Response.json(metadata(saved ? "new" : "old"));
    }
  );
  const old = read("racing");
  await oldStarted.promise;
  assert.deepEqual(await edit("racing"), { success: true });
  const fresh = read("racing");
  await freshStarted.promise;
  oldResult.resolve(Response.json([{ partNumber: "old" }]));
  assert.equal((await old)[0].partNumber, "old");
  const concurrent = read("racing");
  freshResult.resolve(Response.json([{ partNumber: "new" }]));
  assert.equal((await fresh)[0].partNumber, "new");
  assert.equal((await concurrent)[0].partNumber, "new");
  assert.equal((await read("racing"))[0].partNumber, "new");
  assert.equal(reads, 2);
});

test("usage counts successful metadata HTTP traffic including malformed data and excludes HTTP rejections", async (t) => {
  const { Route: usage } = await import("../app/routes/api/onshape/usage");
  async function calls() {
    const request = sessionRequest("editor");
    const response = await inRequest(request, () =>
      getHandler(usage)({ request })
    );
    return (await response.json()).totals.calls;
  }
  const before = await calls();
  let saved = false;
  let mode = "confirmed";
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (mode === "rejected")
        return Response.json({ message: "Denied" }, { status: 403 });
      if (mode === "malformed") return Response.json({ properties: null });
      if (request.method === "POST") {
        saved = true;
        return new Response(null, { status: 204 });
      }
      return Response.json(metadata(saved ? "new" : "old"));
    }
  );
  assert.deepEqual(await edit("usage"), { success: true });
  assert.equal((await calls()) - before, 3);
  mode = "malformed";
  assert.equal((await edit("usage-malformed")).success, false);
  assert.equal((await calls()) - before, 4);
  mode = "rejected";
  assert.equal((await edit("usage-rejected")).success, false);
  assert.equal((await calls()) - before, 4);
});

test("accepted write with invalid JSON is confirmed by metadata and evicts stale immutable parts", async (t) => {
  let saved = false;
  let writes = 0;
  let partsReads = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.url.includes("/parts/")) {
        partsReads++;
        return Response.json([{ partNumber: saved ? "new" : "old" }]);
      }
      if (request.method === "POST") {
        writes++;
        saved = true;
        return new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return Response.json(metadata(saved ? "new" : "old"));
    }
  );
  assert.equal((await read("invalid-write-json"))[0].partNumber, "old");
  const before = await usageCalls();
  const result = await edit("invalid-write-json");
  assert.equal((await usageCalls()) - before, 3);
  assert.equal((await read("invalid-write-json"))[0].partNumber, "new");
  assert.deepEqual(result, { success: true });
  assert.equal(partsReads, 2);
  assert.equal(writes, 1);
});

async function usageCalls() {
  const { Route } = await import("../app/routes/api/onshape/usage");
  const request = sessionRequest("editor");
  const response = await inRequest(request, () =>
    getHandler(Route)({ request })
  );
  return (await response.json()).totals.calls;
}

test("invalid verification JSON leaves an accepted write unconfirmed, evicts stale parts, and counts all successful metadata traffic", async (t) => {
  let saved = false;
  let writes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.url.includes("/parts/"))
        return Response.json([{ partNumber: saved ? "new" : "old" }]);
      if (request.method === "POST") {
        writes++;
        saved = true;
      }
      return saved
        ? new Response("{", {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : Response.json(metadata("old"));
    }
  );
  await read("invalid-verification-json");
  const before = await usageCalls();
  const result = await edit("invalid-verification-json");
  assert.equal(result.success, false);
  assert.match(result.error, /may have succeeded.*could not be confirmed/i);
  assert.equal(writes, 1);
  assert.equal((await usageCalls()) - before, 3);
  assert.equal((await read("invalid-verification-json"))[0].partNumber, "new");
});

test("invalid initial metadata JSON counts its successful HTTP response without writing", async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      assert.equal(request.method, "GET");
      calls++;
      return new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  );
  const before = await usageCalls();
  const result = await edit("invalid-initial-json");
  assert.equal(result.success, false);
  assert.equal(calls, 1);
  assert.equal((await usageCalls()) - before, 1);
});

test("accepted write with a failed body stream still evicts old parts and confirms through independent metadata", async (t) => {
  let saved = false;
  let writes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.url.includes("/parts/"))
        return Response.json([{ partNumber: saved ? "new" : "old" }]);
      if (request.method === "POST") {
        writes++;
        saved = true;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("Write response body disconnected"));
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return Response.json(metadata(saved ? "new" : "old"));
    }
  );
  await read("failed-write-body");
  const before = await usageCalls();
  const result = await edit("failed-write-body");
  assert.equal((await read("failed-write-body"))[0].partNumber, "new");
  assert.deepEqual(result, { success: true });
  assert.equal(writes, 1);
  // Three metadata calls plus the ordinary parts read after eviction.
  assert.equal((await usageCalls()) - before, 4);
});
