import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dataDir = await mkdtemp(join(tmpdir(), "hawk-identity-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));
const { handlePartNumberUpdate } =
  await import("../app/onshape_connector/actions/partNumberUpdate");
import { inRequest, sessionRequest, getHandler } from "./request-context";

test("interleaved part-number operations retain their initiating identity through metadata read and write", async (t) => {
  const sent: { method: string; token: string | null; url: string }[] = [];
  let release!: () => void;
  const bothReads = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const updated = new Set<string>();
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      assert.equal(
        request.url.startsWith("https://cad.onshape.com/api/v12/"),
        true
      );
      sent.push({
        method: request.method,
        token: request.headers.get("authorization"),
        url: request.url,
      });
      if (request.method === "GET") {
        if (++reads === 2) release();
        await bothReads;
        return Response.json({
          properties: [
            {
              name: "Part number",
              propertyId: "pn",
              value: updated.has(new URL(request.url).pathname)
                ? "2713"
                : "old",
              editable: true,
            },
          ],
        });
      }
      updated.add(new URL(request.url).pathname);
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
  const responses = await Promise.all([run("alice"), run("bob")]);
  for (const response of responses) {
    assert.equal((await response.json()).success, true);
    assert.equal(response.headers.has("set-cookie"), false);
  }
  for (const { token, url } of sent)
    assert.equal(token, url.includes("alice") ? "Bearer alice" : "Bearer bob");
  assert.equal(
    sent.some(({ method }) => method === "POST"),
    true
  );
});

test("parallel parts, version and thumbnail reads near expiry do not renew or write cookies", async (t) => {
  const { Route: parts } = await import("../app/routes/api/onshape/parts");
  const { Route: version } = await import("../app/routes/api/onshape/version");
  const { Route: thumbnail } =
    await import("../app/routes/api/onshape/thumbnail");
  const sent: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      sent.push(request.url);
      assert.equal(request.headers.get("authorization"), "Bearer near-expiry");
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
        sessionRequest("near-expiry")
      );
      const response = await inRequest(request, () =>
        getHandler(route)({ request })
      );
      assert.equal(response.status, route === thumbnail ? 307 : 200);
      assert.equal(response.headers.has("set-cookie"), false);
    })
  );
  assert.equal(sent.length, 3);
  assert.equal(
    sent.some((url) => url.includes("oauth")),
    false
  );
});

test("interleaved parts and version reads use each initiating session's bearer token", async (t) => {
  const { Route: parts } = await import("../app/routes/api/onshape/parts");
  const { Route: version } = await import("../app/routes/api/onshape/version");
  const sent: { url: string; token: string | null }[] = [];
  let release!: () => void;
  const allStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      sent.push({
        url: request.url,
        token: request.headers.get("authorization"),
      });
      if (sent.length === 4) release();
      await allStarted;
      return Response.json(
        request.url.includes("versions") ? { name: "v1" } : []
      );
    }
  );
  await Promise.all(
    ["alice", "bob"].flatMap((identity) =>
      [
        [
          parts,
          `/api/onshape/parts?documentId=${identity}&instanceType=w&instanceId=workspace&elementId=studio`,
        ],
        [
          version,
          `/api/onshape/version?documentId=${identity}&versionId=version`,
        ],
      ].map(async ([route, path]) => {
        const request = new Request(
          new URL(path as string, "http://localhost"),
          sessionRequest(identity)
        );
        const response = await inRequest(request, () =>
          getHandler(route)({ request })
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.has("set-cookie"), false);
      })
    )
  );
  for (const { url, token } of sent)
    assert.equal(token, url.includes("alice") ? "Bearer alice" : "Bearer bob");
});

test("cached parts, versions and thumbnails still deny unusable sessions", async (t) => {
  const { Route: parts } = await import("../app/routes/api/onshape/parts");
  const { Route: version } = await import("../app/routes/api/onshape/version");
  const { Route: thumbnail } =
    await import("../app/routes/api/onshape/thumbnail");
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Cache authorization must not contact Onshape");
  });
  for (const cookie of [
    "",
    "onshape_access_token=missing-expiry",
    `onshape_access_token=expired; onshape_expires_at=${Date.now() - 1}`,
  ]) {
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
        headers: { cookie },
      });
      const response = await inRequest(request, () =>
        getHandler(route)({ request })
      );
      assert.equal(response.status, 401);
      assert.equal(response.headers.has("set-cookie"), false);
    }
  }
});

test("explicit OAuth renewal rotates session cookies and keeps the same-origin redirect", async (t) => {
  const { Route } = await import("../app/routes/auth/onshape.index");
  process.env.ONSHAPE_CLIENT_ID = "test-client";
  process.env.ONSHAPE_CLIENT_SECRET = "test-secret";
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(input, "https://oauth.onshape.com/oauth/token");
      assert.equal(
        new URLSearchParams(init?.body as string).get("refresh_token"),
        "refresh-oauth"
      );
      return Response.json({
        access_token: "renewed",
        refresh_token: "rotated",
        expires_in: 3600,
      });
    }
  );
  const request = new Request(
    "http://localhost/auth/onshape?redirect=%2Fkanban",
    sessionRequest("oauth")
  );
  const response = await inRequest(request, () =>
    getHandler(Route)({ request })
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost/kanban");
  const cookies = response.headers.getSetCookie().join("\n");
  assert.match(cookies, /onshape_access_token=renewed/);
  assert.match(cookies, /onshape_refresh_token=rotated/);
  assert.match(cookies, /onshape_expires_at=/);
  assert.match(cookies, /HttpOnly/);
});

test("explicit OAuth renewal rejection clears credentials and starts a new authorization flow", async (t) => {
  const { Route } = await import("../app/routes/auth/onshape.index");
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("invalid_grant", { status: 400 })
  );
  const request = new Request(
    "http://localhost/auth/onshape?redirect=https://evil.test/",
    sessionRequest("rejected")
  );
  const response = await inRequest(request, () =>
    getHandler(Route)({ request })
  );
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get("location")!);
  assert.equal(redirect.origin, "https://oauth.onshape.com");
  assert.equal(
    redirect.searchParams.get("redirect_uri"),
    "http://localhost/auth/onshape/callback"
  );
  const cookies = response.headers.getSetCookie().join("\n");
  for (const name of ["access_token", "refresh_token", "expires_at", "user_id"])
    assert.match(cookies, new RegExp(`onshape_${name}=; Max-Age=0`));
  assert.match(cookies, /onshape_oauth_state=/);
  assert.match(cookies, /onshape_oauth_redirect=%2F/);
});
