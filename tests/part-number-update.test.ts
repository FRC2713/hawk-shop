import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dataDir = await mkdtemp(join(tmpdir(), "hawk-part-number-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));
const { handlePartNumberUpdate } =
  await import("../src/onshape_connector/actions/partNumberUpdate");
import {
  inRequest,
  ONSHAPE_SIGNATURE,
  sessionRequest,
} from "./request-context";

function form(partNumber = "2713") {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    partId: "part",
    partNumber,
    documentId: "doc",
    instanceType: "w",
    instanceId: "workspace",
    elementId: "studio",
  }))
    data.set(key, value);
  return data;
}
const metadata = (value = "old") => ({
  properties: [{ name: "Part number", propertyId: "pn", value }],
});
async function update(data = form()) {
  const request = sessionRequest("editor");
  const response = await inRequest(request, async () =>
    Response.json(await handlePartNumberUpdate(data, request))
  );
  return response.json();
}

test("returned write rejection is a failure with the upstream reason and is never verified or replayed", async (t) => {
  const methods: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      methods.push(request.method);
      return request.method === "POST"
        ? Response.json({ message: "Workspace is read only" }, { status: 403 })
        : Response.json(metadata("2713"));
    }
  );
  const result = await update();
  assert.equal(result.success, false);
  assert.match(result.error, /Workspace is read only/);
  assert.deepEqual(methods, ["GET", "POST"]);
});

test("an accepted write with a mismatched verification is explicitly unconfirmed and is not replayed", async (t) => {
  const methods: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      methods.push(request.method);
      return Response.json(request.method === "POST" ? {} : metadata("old"));
    }
  );
  const result = await update();
  assert.equal(result.success, false);
  assert.match(result.error, /may have succeeded.*could not be confirmed/i);
  assert.deepEqual(methods, ["GET", "POST", "GET"]);
});

test("verification transport failure reports an unconfirmed write without replay", async (t) => {
  let reads = 0;
  let writes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.method === "POST") {
        writes++;
        return Response.json({});
      }
      if (++reads === 2) throw new Error("Network unavailable");
      return Response.json(metadata());
    }
  );
  const result = await update();
  assert.equal(result.success, false);
  assert.match(result.error, /may have succeeded.*could not be confirmed/i);
  assert.equal(writes, 1);
});

test("metadata HTTP failure preserves its reason and cannot proceed to a write", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(
      { message: "Metadata permission denied" },
      { status: 403 }
    );
  });
  const result = await update();
  assert.equal(result.success, false);
  assert.match(result.error, /Metadata permission denied/);
  assert.equal(calls, 1);
});

test("malformed part-number metadata is rejected before writing", async (t) => {
  let writes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.method === "POST") writes++;
      return Response.json({
        properties: [{ name: "Part number", propertyId: 42 }],
      });
    }
  );
  const result = await update();
  assert.equal(result.success, false);
  assert.match(
    result.error,
    /part number property.*(missing|malformed|not found)/i
  );
  assert.equal(writes, 0);
});

test("verification HTTP rejection remains unconfirmed and explains the verification failure", async (t) => {
  let reads = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (request.method === "POST") return Response.json({});
      return ++reads === 1
        ? Response.json(metadata())
        : Response.json(
            { message: "Verification permission denied" },
            { status: 403 }
          );
    }
  );
  const result = await update();
  assert.equal(result.success, false);
  assert.match(result.error, /may have succeeded.*could not be confirmed/i);
  assert.match(result.error, /Verification permission denied/);
});

test("blank normalized part numbers are rejected without contacting Onshape", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json(metadata());
  });
  const result = await update(form("   "));
  assert.equal(result.success, false);
  assert.match(result.error, /partNumber/);
  assert.equal(calls, 0);
});

test("confirmed writes send one JSON object and verify the normalized number for supported property names", async (t) => {
  for (const property of [
    { name: "Part number", propertyId: "pn" },
    { name: "PartNumber", propertyId: "pn" },
    { name: "PART_NUMBER", propertyId: "pn" },
    { name: "Custom", propertyId: "custom_partnumber" },
    { name: "Custom", propertyId: "custom_part_number" },
  ]) {
    let saved = false;
    const methods: string[] = [];
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        assert.match(request.headers.get("authorization")!, ONSHAPE_SIGNATURE);
        methods.push(request.method);
        if (request.method === "POST") {
          assert.deepEqual(await request.json(), {
            jsonType: "metadata-part",
            partId: "part",
            properties: [
              { value: "2713-002", propertyId: property.propertyId },
            ],
          });
          saved = true;
          return new Response(null, { status: 204 });
        }
        return Response.json({
          properties: [{ ...property, value: saved ? "2713-002" : "old" }],
        });
      }
    );
    assert.deepEqual(await update(form("  2713-002  ")), { success: true });
    assert.deepEqual(methods, ["GET", "POST", "GET"]);
    fetchMock.mock.restore();
  }
});

test("missing and malformed discovery metadata never triggers a write", async (t) => {
  for (const data of [
    null,
    {},
    { properties: {} },
    { properties: [] },
    { properties: [null, 42, { name: 42, propertyId: 42 }] },
    { properties: [{ name: "Material", propertyId: "material" }] },
  ]) {
    let calls = 0;
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        assert.equal(request.method, "GET");
        calls++;
        return Response.json(data);
      }
    );
    const result = await update();
    assert.equal(result.success, false);
    assert.match(result.error, /metadata|property/i);
    assert.equal(calls, 1);
    fetchMock.mock.restore();
  }
});

test("missing or malformed verification values never confirm an accepted write", async (t) => {
  for (const data of [
    null,
    {},
    { properties: {} },
    { properties: [] },
    { properties: [{ propertyId: "pn", value: 2713 }] },
    { properties: [{ propertyId: "other", value: "2713" }] },
  ]) {
    let reads = 0;
    let writes = 0;
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        if (request.method === "POST") {
          writes++;
          return Response.json({});
        }
        return Response.json(++reads === 1 ? metadata() : data);
      }
    );
    const result = await update();
    assert.equal(result.success, false);
    assert.match(result.error, /may have succeeded.*could not be confirmed/i);
    assert.equal(writes, 1);
    fetchMock.mock.restore();
  }
});

test("initial metadata transport failure is a failure without mutation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Metadata network failed");
  });
  const result = await update();
  assert.equal(result.success, false);
  assert.match(result.error, /Metadata network failed/);
});

test("the manufacturing action exposes unconfirmed and rejected edits as structured HTTP 400 failures", async (t) => {
  const Route = await import("../src/pages/api/mfg/parts/actions");
  const { currentRequest } = await import("../src/server/request-context");
  const handler = async (_context: { request: Request }) =>
    Route.POST(currentRequest());
  for (const rejected of [true, false]) {
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        return request.method === "POST" && rejected
          ? Response.json({ message: "Edit rejected" }, { status: 403 })
          : Response.json(metadata("old"));
      }
    );
    const request = new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: sessionRequest("editor").headers,
      body: form(),
    });
    const response = await inRequest(request, () => handler({ request }));
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.success, false);
    assert.match(
      result.error,
      rejected ? /Edit rejected/ : /may have succeeded.*could not be confirmed/i
    );
    assert.deepEqual(response.headers.getSetCookie(), []);
    fetchMock.mock.restore();
  }
});
