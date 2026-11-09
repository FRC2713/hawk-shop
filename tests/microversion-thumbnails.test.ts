import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-microversion-"));
process.env.DATA_DIR = dataDir;
// Each explicit connector read below invalidates its document, as a webhook
// would. Keep release checks inside a fresh ordinary cache lifetime.
process.env.ONSHAPE_CACHE_TTL_SECONDS = "300";
after(() => rm(dataDir, { recursive: true, force: true }));

const { endpoint, jsonRequest, signIn } = await import("./http-fixture");
const cardsRoute = await import("../src/pages/api/kanban/cards/index");
const partsRoute = await import("../src/pages/api/onshape/parts");
const thumbnailRoute = await import("../src/pages/api/onshape/thumbnail");
const filesRoute = await import("../src/pages/api/files/[...path]");
const actionsRoute = await import("../src/pages/api/mfg/parts/actions");
const usageRoute = await import("../src/pages/api/onshape/usage");

const cookie = await signIn();
const { invalidateOnshapeCacheForDocument } =
  await import("../src/lib/onshapeApi/cache");

/**
 * A fake Onshape: one Part Studio whose parts' microversions the test sets.
 *
 * Thumbnail hrefs have Onshape's real shape (observed 2026-11-09):
 * `/api/thumbnails/<40-hex id>/s/300x300`, with no document, element or part
 * id in the path. Whether the id changes when the part's geometry does is not
 * yet observed, so `contentAddressed` models both: false keeps one href per
 * part that serves the current picture; true gives each microversion its own
 * href.
 */
function fakeOnshape(
  t: TestContext,
  documentId: string,
  { contentAddressed = false } = {}
) {
  const microversions = new Map<string, string>();
  const thumbnailFetches: string[] = [];
  const thumbnailIds = new Map<
    string,
    { partId: string; microversionId: string | null }
  >();
  let partsReads = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname.includes("/parts/")) {
        partsReads++;
        return Response.json(
          [...microversions].map(([partId, microversionId]) => ({
            partId,
            microversionId,
            partNumber: `PN-${documentId}-${partId}`,
            material: { displayName: "Aluminum" },
            thumbnailInfo: {
              sizes: [{ size: "300x300", href: thumbnailHref(partId) }],
            },
          }))
        );
      }
      const thumbnail = /^\/api\/thumbnails\/([0-9a-f]{40})\/s\//.exec(
        url.pathname
      );
      // Observed 2026-11-09: a thumbnail asked for as JSON answers 406.
      if (thumbnail && request.headers.get("Accept") === "application/json")
        return Response.json(
          { message: "Request not acceptable.", status: 406 },
          { status: 406 }
        );
      if (thumbnail && thumbnailIds.has(thumbnail[1])) {
        const { partId, microversionId } = thumbnailIds.get(thumbnail[1])!;
        thumbnailFetches.push(partId);
        // A per-part href serves whatever the part looks like now.
        return new Response(
          `image of ${partId} at ${microversionId ?? microversions.get(partId)}`,
          {
            headers: { "Content-Type": "image/png" },
          }
        );
      }
      return Response.json({ message: "unexpected" }, { status: 500 });
    }
  );
  function thumbnailHref(partId: string) {
    const microversionId = contentAddressed
      ? (microversions.get(partId) ?? null)
      : null;
    const id = createHash("sha1")
      .update(`${documentId}:${partId}:${microversionId ?? ""}`)
      .digest("hex");
    thumbnailIds.set(id, { partId, microversionId });
    return `https://cad.onshape.com/api/thumbnails/${id}/s/300x300`;
  }
  return {
    microversions,
    thumbnailFetches,
    thumbnailHref,
    get partsReads() {
      return partsReads;
    },
  };
}

async function readParts(documentId: string) {
  invalidateOnshapeCacheForDocument(documentId);
  const query = new URLSearchParams({
    documentId,
    instanceType: "w",
    instanceId: "ws",
    elementId: "studio",
  });
  const response = await endpoint(
    partsRoute,
    "GET"
  )(
    new Request(`http://localhost/api/onshape/parts?${query}`, {
      headers: { Cookie: cookie },
    })
  );
  assert.equal(response.status, 200);
  return (await response.json()) as Array<{
    partId: string;
    microversionId: string;
    thumbnailInfo: { sizes: { href: string }[] };
  }>;
}

/** Release a part the way the connector does, from the part it just read. */
async function release(
  documentId: string,
  part: Awaited<ReturnType<typeof readParts>>[number]
) {
  const form = new FormData();
  Object.entries({
    action: "addCard",
    partNumber: `PN-${documentId}-${part.partId}`,
    documentId,
    instanceType: "w",
    instanceId: "ws",
    elementId: "studio",
    partId: part.partId,
    microversionId: part.microversionId,
    rawThumbnailUrl: part.thumbnailInfo.sizes[0].href,
    processIds: "process-other",
    quantityPerRobot: "1",
    quantityToMake: "1",
  }).forEach(([key, value]) => form.set(key, value));
  const response = await endpoint(
    actionsRoute,
    "POST"
  )(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost" },
      body: form,
    })
  );
  const result = await response.json();
  assert.equal(result.success, true, result.error);
  return result.data as { id: string; onshape_microversion_id: string | null };
}

/** Follow the thumbnail route's redirect and return the image body. */
async function thumbnail(query: string) {
  const response = await endpoint(
    thumbnailRoute,
    "GET"
  )(
    new Request(`http://localhost/api/onshape/thumbnail?${query}`, {
      headers: { Cookie: cookie },
    })
  );
  assert.equal(response.status, 307, await response.clone().text());
  const location = new URL(
    response.headers.get("Location")!,
    "http://localhost"
  );
  const prefix = "/api/files/";
  assert.ok(location.pathname.startsWith(prefix), location.pathname);
  const file = await endpoint(filesRoute, "GET", {
    path: location.pathname.slice(prefix.length),
  })(new Request(location, { headers: { Cookie: cookie } }));
  assert.equal(file.status, 200);
  return file.text();
}

async function thumbnailCalls() {
  const response = await endpoint(
    usageRoute,
    "GET"
  )(
    new Request("http://localhost/api/onshape/usage", {
      headers: { Cookie: cookie },
    })
  );
  const usage = await response.json();
  return usage.byDay
    .filter((row: { label: string }) => row.label === "thumbnail")
    .reduce((sum: number, row: { calls: number }) => sum + row.calls, 0);
}

test("a released card saves the part's microversion without another Onshape call", async (t) => {
  const onshape = fakeOnshape(t, "doc-release");
  onshape.microversions.set("P1", "mv-1");
  const [part] = await readParts("doc-release");
  const readsBefore = onshape.partsReads;
  const card = await release("doc-release", part);
  assert.equal(card.onshape_microversion_id, "mv-1");
  assert.equal(onshape.partsReads, readsBefore);
  assert.equal(onshape.thumbnailFetches.length, 0);
});

test("a changed microversion fetches exactly one new thumbnail and the card serves it", async (t) => {
  const onshape = fakeOnshape(t, "doc-change");
  onshape.microversions.set("P1", "mv-1");
  const [part] = await readParts("doc-change");
  const card = await release("doc-change", part);

  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-1");
  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-1");
  assert.deepEqual(onshape.thumbnailFetches, ["P1"]);

  // The designer edits the part; the connector's next parts read sees it.
  onshape.microversions.set("P1", "mv-2");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await readParts("doc-change");

  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-2");
  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-2");
  assert.deepEqual(onshape.thumbnailFetches, ["P1", "P1"]);
});

/** The thumbnail query the connector sends for a part it just read. */
function connectorQuery(
  documentId: string,
  part: Awaited<ReturnType<typeof readParts>>[number]
) {
  return new URLSearchParams({
    url: part.thumbnailInfo.sizes[0].href,
    documentId,
    elementId: "studio",
    partId: part.partId,
    microversionId: part.microversionId,
  }).toString();
}

test("the connector shows a part's new picture once its microversion changes", async (t) => {
  const onshape = fakeOnshape(t, "doc-connector-change");
  onshape.microversions.set("P1", "mv-1");
  const [before] = await readParts("doc-connector-change");
  assert.equal(
    await thumbnail(connectorQuery("doc-connector-change", before)),
    "image of P1 at mv-1"
  );

  onshape.microversions.set("P1", "mv-2");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const [after] = await readParts("doc-connector-change");
  // Same href, new microversion: the stored mv-1 picture must not answer.
  assert.equal(
    after.thumbnailInfo.sizes[0].href,
    before.thumbnailInfo.sizes[0].href
  );
  assert.equal(
    await thumbnail(connectorQuery("doc-connector-change", after)),
    "image of P1 at mv-2"
  );
  assert.deepEqual(onshape.thumbnailFetches, ["P1", "P1"]);
});

test("when Onshape gives an edited part a new thumbnail href, its card follows it", async (t) => {
  const onshape = fakeOnshape(t, "doc-new-href", { contentAddressed: true });
  onshape.microversions.set("P1", "mv-1");
  const [part] = await readParts("doc-new-href");
  const card = await release("doc-new-href", part);
  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-1");

  onshape.microversions.set("P1", "mv-2");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await readParts("doc-new-href");

  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-2");
  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-2");
  assert.deepEqual(onshape.thumbnailFetches, ["P1", "P1"]);
});

test("two parts reads with the same microversions cost one thumbnail fetch per part", async (t) => {
  const onshape = fakeOnshape(t, "doc-same");
  onshape.microversions.set("P1", "mv-a");
  onshape.microversions.set("P2", "mv-b");
  const callsBefore = await thumbnailCalls();

  for (let read = 0; read < 2; read++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const part of await readParts("doc-same")) {
      assert.equal(
        await thumbnail(connectorQuery("doc-same", part)),
        `image of ${part.partId} at ${part.microversionId}`
      );
    }
  }
  assert.equal(onshape.partsReads, 2);
  assert.deepEqual(onshape.thumbnailFetches.sort(), ["P1", "P2"]);
  assert.equal((await thumbnailCalls()) - callsBefore, 2);

  // A card released from that read shares the connector's image.
  const [part] = await readParts("doc-same");
  const card = await release("doc-same", part);
  await thumbnail(`cardId=${card.id}`);
  assert.equal(onshape.thumbnailFetches.length, 2);
});

test("a legacy thumbnail row with no microversion is served without a refetch", async (t) => {
  const onshape = fakeOnshape(t, "doc-legacy");
  onshape.microversions.set("P1", "mv-old");
  const href = onshape.thumbnailHref("P1");
  // Stored before microversion keys: by URL only.
  assert.equal(
    await thumbnail(`url=${encodeURIComponent(href)}`),
    "image of P1 at mv-old"
  );
  assert.equal(onshape.thumbnailFetches.length, 1);

  // After the upgrade, the connector asks by microversion and gets that row.
  const [part] = await readParts("doc-legacy");
  assert.equal(
    await thumbnail(connectorQuery("doc-legacy", part)),
    "image of P1 at mv-old"
  );
  const card = await release("doc-legacy", part);
  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-old");
  assert.equal(onshape.thumbnailFetches.length, 1);

  // The adopted image belongs to that microversion only.
  onshape.microversions.set("P1", "mv-new");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await readParts("doc-legacy");
  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-new");
  assert.equal(onshape.thumbnailFetches.length, 2);
});

test("a card from before microversions keeps its legacy proxy image_url and its picture", async (t) => {
  const onshape = fakeOnshape(t, "doc-proxy");
  onshape.microversions.set("P1", "mv-1");
  const href = onshape.thumbnailHref("P1");
  const created = await endpoint(
    cardsRoute,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", cookie, {
      id: "legacy-proxy",
      title: "Old bracket",
      imageUrl: `/api/onshape/thumbnail?url=${encodeURIComponent(href)}`,
      onshapeDocumentId: "doc-proxy",
      onshapeInstanceType: "w",
      onshapeInstanceId: "ws",
      onshapeElementId: "studio",
      onshapePartId: "P1",
    })
  );
  assert.equal(created.status, 201, await created.clone().text());

  assert.equal(await thumbnail("cardId=legacy-proxy"), "image of P1 at mv-1");
  // A later parts read leaves a card with no recorded microversion alone.
  onshape.microversions.set("P1", "mv-2");
  await readParts("doc-proxy");
  assert.equal(await thumbnail("cardId=legacy-proxy"), "image of P1 at mv-1");
  assert.equal(onshape.thumbnailFetches.length, 1);
});

test("a connector request whose part ids don't match its url can't replace another part's thumbnail", async (t) => {
  const onshape = fakeOnshape(t, "doc-mismatch");
  onshape.microversions.set("P1", "mv-1");
  onshape.microversions.set("P2", "mv-2");
  const parts = await readParts("doc-mismatch");
  const p1 = parts.find((part) => part.partId === "P1")!;
  const p2 = parts.find((part) => part.partId === "P2")!;

  // P1's identity with P2's picture must not be stored as P1's thumbnail.
  const mismatched = new URLSearchParams({
    url: p2.thumbnailInfo.sizes[0].href,
    documentId: "doc-mismatch",
    elementId: "studio",
    partId: "P1",
    microversionId: "mv-1",
  }).toString();
  assert.equal(await thumbnail(mismatched), "image of P2 at mv-2");

  assert.equal(
    await thumbnail(connectorQuery("doc-mismatch", p1)),
    "image of P1 at mv-1"
  );
  const card = await release("doc-mismatch", p1);
  assert.equal(await thumbnail(`cardId=${card.id}`), "image of P1 at mv-1");
});
