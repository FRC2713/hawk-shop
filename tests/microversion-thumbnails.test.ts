import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "hawk-microversion-"));
process.env.DATA_DIR = dataDir;
// Workspace parts reads expire almost at once, so each read in a test reaches
// the mocked Onshape and can report a new microversion.
process.env.ONSHAPE_CACHE_TTL_SECONDS = "0.001";
after(() => rm(dataDir, { recursive: true, force: true }));

const { endpoint, jsonRequest, signIn } = await import("./http-fixture");
const cardsRoute = await import("../src/pages/api/kanban/cards/index");
const partsRoute = await import("../src/pages/api/onshape/parts");
const thumbnailRoute = await import("../src/pages/api/onshape/thumbnail");
const filesRoute = await import("../src/pages/api/files/[...path]");
const actionsRoute = await import("../src/pages/api/mfg/parts/actions");
const usageRoute = await import("../src/pages/api/onshape/usage");

const cookie = await signIn();

/** A fake Onshape: one Part Studio whose parts' microversions the test sets. */
function fakeOnshape(t: TestContext, documentId: string) {
  const microversions = new Map<string, string>();
  const thumbnailFetches: string[] = [];
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
            partNumber: `PN-${partId}`,
            thumbnailInfo: {
              sizes: [{ size: "300x300", href: thumbnailHref(partId) }],
            },
          }))
        );
      }
      if (url.pathname.includes("/thumbnails/")) {
        const partId = url.pathname.split("/p/")[1];
        thumbnailFetches.push(partId);
        // The workspace URL never changes; the picture it returns does.
        return new Response(
          `image of ${partId} at ${microversions.get(partId)}`,
          {
            headers: { "Content-Type": "image/png" },
          }
        );
      }
      return Response.json({ message: "unexpected" }, { status: 500 });
    }
  );
  function thumbnailHref(partId: string) {
    return `https://cad.onshape.com/api/v10/thumbnails/d/${documentId}/w/ws/e/studio/p/${partId}?outputFormat=PNG&pixelSize=300`;
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
    partNumber: `PN-${part.partId}`,
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
  const location = new URL(response.headers.get("Location")!);
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
