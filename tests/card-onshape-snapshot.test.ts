import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test, type TestContext } from "node:test";
import { endpoint } from "./http-fixture";
import { sessionRequest } from "./request-context";
const dir = mkdtempSync(join(tmpdir(), "hawk-snapshot-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = join(dir, "shop.db");
delete process.env.ONSHAPE_WEBHOOK_SECRET;
after(() => rmSync(dir, { recursive: true, force: true }));

const releaseAction = endpoint(
  await import("../src/pages/api/mfg/parts/actions"),
  "POST"
);
const readVersion = endpoint(
  await import("../src/pages/api/onshape/version"),
  "GET"
);
const readCardsRoute = endpoint(
  await import("../src/pages/api/kanban/cards/index"),
  "GET"
);
const parts = await import("../src/onshape_connector/utils/partsQuery.server");

const headers = () => sessionRequest("student").headers;

async function readCard(id: string) {
  const response = await readCardsRoute(
    new Request("http://localhost/api/kanban/cards", { headers: headers() }),
    {}
  );
  assert.equal(response.status, 200);
  return (await response.json()).cards.find(
    (card: { id: string }) => card.id === id
  );
}

/** Counts upstream Onshape calls by kind; parts and version reads only. */
function stubOnshape(
  t: TestContext,
  answer: {
    parts?: () => Response;
    version?: () => Response;
  }
) {
  const calls = { parts: 0, version: 0 };
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/\/versions\/[^/?]+/.test(url)) {
      calls.version++;
      return answer.version?.() ?? Response.json({}, { status: 404 });
    }
    if (url.includes("/parts/")) {
      calls.parts++;
      return answer.parts?.() ?? Response.json([], { status: 500 });
    }
    throw new Error(`Unexpected Onshape call: ${url}`);
  });
  return calls;
}

function scopeFor(documentId: string) {
  return {
    documentId,
    instanceType: "v" as const,
    instanceId: `${documentId}-version`,
    elementId: "studio",
    elementType: "PARTSTUDIO",
  };
}

async function release(
  scope: ReturnType<typeof scopeFor>,
  partId: string,
  partNumber: string
) {
  const form = new FormData();
  Object.entries({
    ...scope,
    action: "addCard",
    partId,
    partNumber,
    processIds: "process-other",
    projectId: "project-miscellaneous",
    quantityToMake: "1",
  }).forEach(([key, value]) => form.set(key, value));
  const response = await releaseAction(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: headers(),
      body: form,
    }),
    {}
  );
  const body = await response.json();
  assert.equal(body.success, true, body.error);
  return body.data as { id: string };
}

async function primeConnectorReads(scope: ReturnType<typeof scopeFor>) {
  // What the connector already reads before a release.
  const { inRequest } = await import("./request-context");
  await inRequest(sessionRequest("student"), async () =>
    Response.json(await parts.fetchPartsFromOnshape(scope))
  );
  const response = await readVersion(
    new Request(
      `http://localhost/api/onshape/version?documentId=${scope.documentId}&versionId=${scope.instanceId}`,
      { headers: headers() }
    ),
    {}
  );
  assert.equal(response.status, 200);
}

test("release captures material and version name without extra Onshape calls", async (t) => {
  const scope = scopeFor("snapshot-release-doc");
  const calls = stubOnshape(t, {
    parts: () =>
      Response.json([
        {
          partId: "bracket",
          partNumber: "BRACKET",
          description: "Bracket",
          material: { displayName: "6061 Aluminum" },
        },
      ]),
    version: () => Response.json({ id: scope.instanceId, name: "V3 Ready" }),
  });
  await primeConnectorReads(scope);
  assert.deepEqual(calls, { parts: 1, version: 1 });

  const bracket = await readCard((await release(scope, "bracket", "x")).id);
  assert.equal(bracket.onshape_material, "6061 Aluminum");
  assert.equal(bracket.onshape_version_name, "V3 Ready");
  assert.deepEqual(calls, { parts: 1, version: 1 });
});

const { createCard } = await import("../src/server/kanbanApi/cards");

/** A card released before snapshots existed. */
async function legacyCard(
  scope: ReturnType<typeof scopeFor>,
  partId: string,
  title: string
) {
  return createCard(
    {
      title,
      onshapeDocumentId: scope.documentId,
      onshapeInstanceType: scope.instanceType,
      onshapeInstanceId: scope.instanceId,
      onshapeElementId: scope.elementId,
      onshapePartId: partId,
      onshapeVersionId: scope.instanceId,
    },
    { onshape_user_id: "student", email: null }
  );
}

async function backfill(id: string) {
  const route = endpoint(
    await import("../src/pages/api/kanban/cards/[id]/snapshot"),
    "POST",
    { id }
  );
  const response = await route(
    new Request(`http://localhost/api/kanban/cards/${id}/snapshot`, {
      method: "POST",
      headers: headers(),
    }),
    { id }
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("an older card is backfilled once with one parts read and one version read", async (t) => {
  const scope = scopeFor("snapshot-backfill-doc");
  const calls = stubOnshape(t, {
    parts: () =>
      Response.json([
        {
          partId: "other",
          partNumber: "OTHER",
          material: { displayName: "Steel" },
        },
        { partId: "legacy", partNumber: "LEGACY" },
      ]),
    version: () =>
      Response.json({ id: scope.instanceId, name: "Season start" }),
  });
  const card = await legacyCard(scope, "legacy", "LEGACY");
  assert.equal((await readCard(card.id)).onshape_material, null);

  const expected = {
    onshape_material: "",
    onshape_version_name: "Season start",
  };
  assert.deepEqual(await backfill(card.id), expected);
  assert.deepEqual(calls, { parts: 1, version: 1 });
  const saved = await readCard(card.id);
  assert.equal(saved.onshape_material, "");
  assert.equal(saved.onshape_version_name, "Season start");

  // Saved on the card, so later opens never touch Onshape or its cache.
  const { invalidateOnshapeCache, cacheKey } =
    await import("../src/lib/onshapeApi/cache");
  const { partStudioFreshness } =
    await import("../src/lib/onshapeApi/partStudioFreshness");
  partStudioFreshness.discard({ ...scope, instanceType: "v" });
  invalidateOnshapeCache(
    cacheKey("version", scope.documentId, scope.instanceId)
  );
  assert.deepEqual(await backfill(card.id), expected);
  assert.deepEqual(calls, { parts: 1, version: 1 });
});

test("a failed backfill answers unknown values, saves nothing and retries on a later open", async (t) => {
  const scope = scopeFor("snapshot-failure-doc");
  let onshapeDown = true;
  const calls = stubOnshape(t, {
    parts: () =>
      onshapeDown
        ? Response.json({ message: "down" }, { status: 503 })
        : Response.json([
            { partId: "flaky", material: { displayName: "Delrin" } },
          ]),
    version: () => Response.json({ id: scope.instanceId, name: "V1" }),
  });
  const card = await legacyCard(scope, "flaky", "FLAKY");
  const unknown = { onshape_material: null, onshape_version_name: null };
  assert.deepEqual(await backfill(card.id), unknown);
  const unsaved = await readCard(card.id);
  assert.equal(unsaved.onshape_material, null);
  assert.equal(unsaved.onshape_version_name, null);

  onshapeDown = false;
  assert.deepEqual(await backfill(card.id), {
    onshape_material: "Delrin",
    onshape_version_name: "V1",
  });
  assert.equal(calls.parts, 2);
});

test("a release whose version read fails still succeeds and backfills the name later", async (t) => {
  const scope = scopeFor("snapshot-version-down-doc");
  let versionDown = true;
  const calls = stubOnshape(t, {
    parts: () =>
      Response.json([
        {
          partId: "plate",
          partNumber: "PLATE",
          description: "Plate",
          material: { displayName: "Polycarbonate" },
        },
      ]),
    version: () =>
      versionDown
        ? Response.json({ message: "down" }, { status: 503 })
        : Response.json({ id: scope.instanceId, name: "V2" }),
  });
  const created = await readCard((await release(scope, "plate", "x")).id);
  assert.equal(created.onshape_material, "Polycarbonate");
  assert.equal(created.onshape_version_name, null);

  versionDown = false;
  assert.deepEqual(await backfill(created.id), {
    onshape_material: "Polycarbonate",
    onshape_version_name: "V2",
  });
  // The release's parts read is cached and immutable, so it is not re-bought.
  assert.equal(calls.parts, 1);
});
