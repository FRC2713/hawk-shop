import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-key-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, ONSHAPE_SIGNATURE, sessionRequest } =
  await import("./request-context");
const { handlePartNumberUpdate } =
  await import("../src/onshape_connector/actions/partNumberUpdate");
const { onshapeFetch, signedOnshapeHeaders } =
  await import("../src/lib/onshapeApi/auth");
const parts = await import("../src/pages/api/onshape/parts");
const version = await import("../src/pages/api/onshape/version");
const thumbnail = await import("../src/pages/api/onshape/thumbnail");

const toRequest = (input: RequestInfo | URL, init?: RequestInit) =>
  input instanceof Request ? input : new Request(input, init);

test("requests are signed as Onshape's API key contract specifies", () => {
  const nonce = "0123456789abcdefghij0123456789abcdefghij";
  const date = "Mon, 09 Nov 2026 01:00:00 GMT";
  const request = new Request(
    "https://cad.onshape.com/api/v12/parts/d/Doc/w/Ws/e/El?withThumbnails=true&Includeflat=false",
    { method: "GET", headers: { Cookie: "suite=secret" } }
  );
  const headers = signedOnshapeHeaders(request, "AK", "SK", nonce, date);
  const canonical = `get\n${nonce}\nmon, 09 nov 2026 01:00:00 gmt\napplication/json\n/api/v12/parts/d/doc/w/ws/e/el\nwiththumbnails=true&includeflat=false\n`;
  const expected = createHmac("sha256", "SK")
    .update(canonical)
    .digest("base64");
  assert.equal(headers.get("authorization"), `On AK:HmacSHA256:${expected}`);
  assert.equal(headers.get("on-nonce"), nonce);
  assert.equal(headers.get("date"), date);
  assert.equal(headers.has("cookie"), false);
});

test("the key is never sent to another host, and redirects are re-signed only on Onshape", async (t) => {
  const sent: { url: string; authorization: string | null }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = toRequest(input, init);
      sent.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
      });
      if (request.url.endsWith("/start"))
        return new Response(null, {
          status: 307,
          headers: { location: "https://acme.onshape.com/api/v12/next" },
        });
      if (request.url.endsWith("/leave"))
        return new Response(null, {
          status: 307,
          headers: { location: "https://evil.test/collect" },
        });
      return Response.json({ ok: true });
    }
  );

  await assert.rejects(
    onshapeFetch("https://evil.test/api"),
    /outside HTTPS Onshape hosts/
  );
  await assert.rejects(
    onshapeFetch("http://cad.onshape.com/api"),
    /outside HTTPS Onshape hosts/
  );
  assert.equal(sent.length, 0);

  const followed = await onshapeFetch("https://cad.onshape.com/api/v12/start");
  assert.equal(followed.status, 200);
  assert.deepEqual(
    sent.map(({ url }) => url),
    [
      "https://cad.onshape.com/api/v12/start",
      "https://acme.onshape.com/api/v12/next",
    ]
  );
  for (const { authorization } of sent)
    assert.match(authorization!, ONSHAPE_SIGNATURE);
  assert.notEqual(sent[0].authorization, sent[1].authorization);

  sent.length = 0;
  await assert.rejects(
    onshapeFetch("https://cad.onshape.com/api/v12/leave"),
    /outside an allowed HTTPS host/
  );
  assert.deepEqual(
    sent.map(({ url }) => url),
    ["https://cad.onshape.com/api/v12/leave"]
  );
});

test("parts, version and thumbnail reads use the server key and set no cookies", async (t) => {
  const sent: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = toRequest(input, init);
      sent.push(request.url);
      assert.match(request.headers.get("authorization")!, ONSHAPE_SIGNATURE);
      if (request.url.includes("thumbnails"))
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      return Response.json(
        request.url.includes("versions") ? { name: "v1" } : []
      );
    }
  );
  const calls = [
    [
      parts,
      "/api/onshape/parts?documentId=doc&instanceType=w&instanceId=workspace&elementId=studio",
    ],
    [version, "/api/onshape/version?documentId=doc&versionId=version"],
    [
      thumbnail,
      "/api/onshape/thumbnail?url=https%3A%2F%2Fcad.onshape.com%2Fthumbnails%2Fimage",
    ],
  ] as const;
  await Promise.all(
    calls.map(async ([route, path]) => {
      const request = new Request(
        new URL(path, "http://localhost"),
        sessionRequest("alice")
      );
      const response = await inRequest(request, () =>
        getHandler(route)({ request })
      );
      assert.equal(response.status, route === thumbnail ? 307 : 200);
      assert.equal(response.headers.has("set-cookie"), false);
    })
  );
  assert.equal(sent.length, 3);
});

test("cached CAD routes still require Suite identity and never contact Onshape without it", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unauthenticated reads must not contact Onshape");
  });
  for (const [route, path] of [
    [
      parts,
      "/api/onshape/parts?documentId=doc&instanceType=w&instanceId=workspace&elementId=studio",
    ],
    [version, "/api/onshape/version?documentId=doc&versionId=version"],
    [
      thumbnail,
      "/api/onshape/thumbnail?url=https%3A%2F%2Fcad.onshape.com%2Fthumbnails%2Fimage",
    ],
  ] as const) {
    const request = new Request(new URL(path, "http://localhost"), {
      headers: { cookie: "onshape_access_token=legacy" },
    });
    const response = await inRequest(request, () =>
      getHandler(route)({ request })
    );
    assert.equal(response.status, 401);
  }
});

test("a missing key pair is a CAD 409, not a Suite sign-out", async (t) => {
  const saved = [
    process.env.ONSHAPE_ACCESS_KEY,
    process.env.ONSHAPE_SECRET_KEY,
  ];
  delete process.env.ONSHAPE_ACCESS_KEY;
  t.after(() => {
    process.env.ONSHAPE_ACCESS_KEY = saved[0];
    process.env.ONSHAPE_SECRET_KEY = saved[1];
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("An unconfigured server must not contact Onshape");
  });
  const request = new Request(
    "http://localhost/api/onshape/parts?documentId=uncached&instanceType=w&instanceId=workspace&elementId=studio",
    sessionRequest("alice")
  );
  const response = await inRequest(request, () =>
    getHandler(parts)({ request })
  );
  assert.equal(response.status, 409);
});

test("interleaved part-number writes are signed with the server key and verified", async (t) => {
  const updated = new Set<string>();
  const methods: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = toRequest(input, init);
      assert.equal(
        request.url.startsWith("https://cad.onshape.com/api/v12/"),
        true
      );
      assert.match(request.headers.get("authorization")!, ONSHAPE_SIGNATURE);
      methods.push(request.method);
      const key = new URL(request.url).pathname;
      if (request.method === "GET")
        return Response.json({
          properties: [
            {
              name: "Part number",
              propertyId: "pn",
              value: updated.has(key) ? "2713" : "old",
              editable: true,
            },
          ],
        });
      updated.add(key);
      return Response.json({});
    }
  );
  const run = (identity: string) => {
    const request = sessionRequest(identity);
    const form = new FormData();
    for (const [key, value] of Object.entries({
      partId: identity,
      partNumber: "2713",
      documentId: "doc",
      instanceType: "w",
      instanceId: "workspace",
      elementId: "studio",
    }))
      form.set(key, value);
    return inRequest(request, async () =>
      Response.json(await handlePartNumberUpdate(form, request))
    );
  };
  for (const response of await Promise.all([run("alice"), run("bob")])) {
    assert.equal((await response.json()).success, true);
    assert.equal(response.headers.has("set-cookie"), false);
  }
  assert.equal(methods.filter((method) => method === "POST").length, 2);
});
