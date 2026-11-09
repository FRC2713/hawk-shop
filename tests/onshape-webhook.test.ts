import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-onshape-webhook-"));
process.env.DATA_DIR = dataDir;
after(() => rm(dataDir, { recursive: true, force: true }));

const { getHandler, inRequest, sessionRequest } =
  await import("./request-context");
const partsRoute = await import("../src/pages/api/onshape/parts");
const webhookRoute = await import("../src/pages/api/onshape/webhook");

const SECRET = "correct-horse-battery-staple";

beforeEach(() => {
  process.env.ONSHAPE_WEBHOOK_SECRET = SECRET;
  process.env.ONSHAPE_WEBHOOK_BASE_URL = "https://shop.example.org";
});

/** A workspace read also registers a webhook; these tests only count reads. */
const isWebhookRegistration = (input: RequestInfo | URL) =>
  /\/api\/v\d+\/webhooks$/.test(
    new URL(input instanceof Request ? input.url : String(input)).pathname
  );

type Scope = { documentId: string; instanceType: "w" | "v" };

/** Count upstream parts reads per scope; every other Onshape call fails. */
function countPartsReads(t: { mock: { method: Function } }) {
  const reads = new Map<string, number>();
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (isWebhookRegistration(request)) return Response.json({ id: "hook" });
      const match = /\/parts\/d\/([^/]+)\/([wvm])\//.exec(request.url);
      assert.ok(match, request.url);
      const key = `${match[1]}/${match[2]}`;
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return Response.json([{ partId: "part", name: key }]);
    }
  );
  return (scope: Scope) =>
    reads.get(`${scope.documentId}/${scope.instanceType}`) ?? 0;
}

async function readParts({ documentId, instanceType }: Scope) {
  const query = new URLSearchParams({
    documentId,
    instanceType,
    instanceId: instanceType === "w" ? "workspace" : "version",
    elementId: "studio",
  });
  const request = new Request(
    `http://localhost/api/onshape/parts?${query}`,
    sessionRequest("student")
  );
  const response = await inRequest(request, () =>
    getHandler(partsRoute)({ request })
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function deliver(
  body: unknown,
  secret: string | null = SECRET
): Promise<Response> {
  const url = new URL("http://localhost/api/onshape/webhook");
  if (secret !== null) url.searchParams.set("secret", secret);
  const request = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (
    webhookRoute as unknown as {
      POST: (context: { request: Request }) => Promise<Response>;
    }
  ).POST({ request });
}

const changed = (documentId: string) => ({
  event: "onshape.model.lifecycle.changed",
  documentId,
  workspaceId: "workspace",
  webhookId: "hook",
  messageId: "message",
});

test("a change event clears only that document's workspace reads", async (t) => {
  const reads = countPartsReads(t);
  const edited = { documentId: "edited", instanceType: "w" } as const;
  const released = { documentId: "edited", instanceType: "v" } as const;
  const other = { documentId: "other", instanceType: "w" } as const;
  for (const scope of [edited, released, other]) await readParts(scope);

  const response = await deliver(changed("edited"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");

  await Promise.all([readParts(edited), readParts(edited)]);
  await readParts(released);
  await readParts(other);
  assert.equal(reads(edited), 2, "the edited workspace is read once more");
  assert.equal(reads(released), 1, "version reads stay cached");
  assert.equal(reads(other), 1, "other documents stay cached");
});

test("a read already in flight when the change arrives is not cached", async (t) => {
  let reads = 0;
  let release!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      if (isWebhookRegistration(input)) return Response.json({ id: "hook" });
      reads++;
      if (reads === 1) {
        resolveStarted();
        await new Promise<void>((resolve) => (release = resolve));
        return Response.json([{ partId: "part", name: "before edit" }]);
      }
      return Response.json([{ partId: "part", name: "after edit" }]);
    });
  });
  const scope = { documentId: "racing", instanceType: "w" } as const;
  const stale = readParts(scope);
  await started;
  assert.equal((await deliver(changed("racing"))).status, 200);
  release();
  assert.equal((await stale)[0].name, "before edit");
  assert.equal((await readParts(scope))[0].name, "after edit");
  assert.equal((await readParts(scope))[0].name, "after edit");
  assert.equal(reads, 2);
});

test("a wrong or missing secret gets an empty 404 and clears nothing", async (t) => {
  const reads = countPartsReads(t);
  const scope = { documentId: "guarded", instanceType: "w" } as const;
  await readParts(scope);
  for (const secret of [
    null,
    "",
    "wrong",
    SECRET.toUpperCase(),
    SECRET + "x",
  ]) {
    const response = await deliver(changed("guarded"), secret);
    assert.equal(response.status, 404, String(secret));
    assert.equal(await response.text(), "");
  }
  await readParts(scope);
  assert.equal(reads(scope), 1);
});

test("unconfigured webhooks answer 404 even to the old secret", async (t) => {
  const reads = countPartsReads(t);
  const scope = { documentId: "unconfigured", instanceType: "w" } as const;
  await readParts(scope);
  for (const unset of ["ONSHAPE_WEBHOOK_SECRET", "ONSHAPE_WEBHOOK_BASE_URL"]) {
    process.env.ONSHAPE_WEBHOOK_SECRET = SECRET;
    process.env.ONSHAPE_WEBHOOK_BASE_URL = "https://shop.example.org";
    delete process.env[unset];
    assert.equal((await deliver(changed("unconfigured"))).status, 404, unset);
  }
  await readParts(scope);
  assert.equal(reads(scope), 1);
});

test("registration pings and malformed deliveries are acknowledged without clearing", async (t) => {
  const reads = countPartsReads(t);
  const scope = { documentId: "pinged", instanceType: "w" } as const;
  await readParts(scope);
  for (const body of [
    { event: "webhook.register", documentId: "pinged", webhookId: "hook" },
    { event: "onshape.model.lifecycle.changed" },
    "not an event",
  ]) {
    const response = await deliver(body);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  }
  await readParts(scope);
  assert.equal(reads(scope), 1);
});
