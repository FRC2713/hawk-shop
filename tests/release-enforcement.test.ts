import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { endpoint } from "./http-fixture";
import { sessionRequest, inRequest } from "./request-context";
const dir = mkdtempSync(join(tmpdir(), "hawk-release-"));
process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = join(dir, "shop.db");
delete process.env.ONSHAPE_WEBHOOK_SECRET;
after(() => rmSync(dir, { recursive: true, force: true }));
const post = endpoint(
  await import("../src/pages/api/mfg/parts/actions"),
  "POST"
);
const { fetchPartsFromOnshape } =
  await import("../src/onshape_connector/utils/partsQuery.server");
const read = endpoint(
  await import("../src/pages/api/kanban/cards/index"),
  "GET"
);
async function readCards() {
  const response = await read(
    new Request("http://localhost/api/kanban/cards", {
      headers: sessionRequest("student").headers,
    }),
    {}
  );
  assert.equal(response.status, 200);
  return (await response.json()).cards;
}
const scope = {
  documentId: "release-doc",
  instanceType: "v" as const,
  instanceId: "version",
  elementId: "studio",
  elementType: "PARTSTUDIO",
};
async function release(partId: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({
    ...scope,
    action: "addCard",
    partId,
    partNumber: "FORGED",
    processIds: "process-other",
    projectId: "project-miscellaneous",
    quantityPerRobot: "4",
    quantityToMake: "2",
    ...extra,
  }).forEach(([key, value]) => form.set(key, value));
  return post(
    new Request("http://localhost/api/mfg/parts/actions", {
      method: "POST",
      headers: sessionRequest("student").headers,
      body: form,
    }),
    {}
  );
}

test("server rejects cached missing material despite forged client metadata without extra upstream calls", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json([
      { partId: "blocked", partNumber: "BLOCKED", description: "Bracket" },
    ]);
  });
  await inRequest(sessionRequest("student"), async () =>
    Response.json(await fetchPartsFromOnshape(scope))
  );
  const response = await release("blocked", { material: "Aluminum" });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "This part has no material.",
  });
  assert.equal(calls, 1);
});

test("server uses cached part facts for every blocker and allows warnings without extra calls", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json([
      { partId: "unnumbered", material: { displayName: "Aluminum" } },
      {
        partId: "warning",
        partNumber: "WARN",
        material: { displayName: "Unknown" },
        microversionId: "actual-micro",
      },
    ]);
  });
  const documentId = "other-release-doc";
  const request = sessionRequest("student");
  await inRequest(request, async () =>
    Response.json(await fetchPartsFromOnshape({ ...scope, documentId }))
  );
  const missingNumber = await release("unnumbered", { documentId });
  assert.equal(missingNumber.status, 400);
  assert.deepEqual(await missingNumber.json(), {
    success: false,
    error: "This part has no part number.",
  });
  const warning = await release("warning", {
    documentId,
    microversionId: "forged-micro",
  });
  const created = await warning.json();
  assert.equal(created.success, true, created.error);
  assert.equal(created.data.title, "WARN");
  assert.equal(created.data.onshape_microversion_id, "actual-micro");
  assert.deepEqual(
    (await readCards()).find(
      (card: { id: string }) => card.id === created.data.id
    ).release_issues,
    [
      {
        code: "missing-description",
        severity: "warning",
        message: "This part has no description.",
        fix: "Add a description in Onshape so the shop knows what it is.",
      },
      {
        code: "quantity-below-per-robot",
        severity: "warning",
        message: "Quantity to make is below quantity per robot.",
        fix: "Check the requested quantities, including any parts already in stock.",
      },
      {
        code: "placeholder-material",
        severity: "warning",
        message: "This part uses a placeholder material.",
        fix: "Choose the stock material in Onshape before manufacturing.",
      },
    ]
  );
  const duplicate = await release("warning", {
    documentId,
    partNumber: "BYPASS-DUPLICATE",
  });
  assert.equal(duplicate.status, 400);
  assert.deepEqual(await duplicate.json(), {
    success: false,
    error: "This part is already in the manufacturing tracker.",
  });
  const unknown = await release("not-in-studio", { documentId });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /not found/);
  assert.equal(calls, 1);
});

test("partial or invalid CAD scope cannot bypass checks", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Invalid scope must not reach Onshape");
  });
  const invalidScopes: Record<string, string>[] = [
    { elementId: "" },
    { partId: "" },
    { instanceType: "invalid" },
  ];
  for (const extra of invalidScopes) {
    const response = await release("warning", extra);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "A complete Onshape part scope is required for release.",
    });
  }
});

test("a clean release stores null warnings, including when a caller submits forged warnings", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json([
      {
        partId: "clean",
        partNumber: "CLEAN",
        description: "Finished bracket",
        material: { displayName: "6061 Aluminum" },
      },
    ])
  );
  const response = await release("clean", {
    documentId: "clean-release-doc",
    quantityToMake: "8",
    release_issues: JSON.stringify([
      { code: "forged", severity: "warning", message: "Forged" },
    ]),
  });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.data.release_issues, null);
  assert.equal(
    (await readCards()).find(
      (card: { id: string }) => card.id === created.data.id
    ).release_issues,
    null
  );
});

test("a workspace or history release is refused before any Onshape call", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("A refused release must not reach Onshape");
  });
  for (const instanceType of ["w", "m"]) {
    const response = await release("clean", {
      documentId: "unversioned-doc",
      instanceType,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Parts can only be released from an Onshape version.",
    });
  }
});

test("workspace edits and card updates preserve a legacy workspace card's warning snapshot", async (t) => {
  let part = {
    partId: "snapshot",
    partNumber: "SNAPSHOT",
    description: "",
    material: { displayName: "Unknown" },
    microversionId: "before",
  };
  t.mock.method(globalThis, "fetch", async () => Response.json([part]));
  const workspace = {
    ...scope,
    documentId: "snapshot-doc",
    instanceType: "w" as const,
  };
  // Workspace releases are refused now, but cards released before that remain.
  const { createCard } = await import("../src/server/kanbanApi/cards");
  const releaseIssues = [
    {
      code: "released-from-workspace",
      severity: "warning" as const,
      message:
        "This part is being released from a workspace that may still change.",
    },
  ];
  const created = await createCard(
    {
      title: "SNAPSHOT",
      releaseIssues,
      onshapeDocumentId: workspace.documentId,
      onshapeInstanceType: "w",
      onshapeInstanceId: workspace.instanceId,
      onshapeElementId: workspace.elementId,
      onshapePartId: "snapshot",
      onshapeVersionId: workspace.instanceId,
      onshapeMicroversionId: "before",
    },
    { onshape_user_id: "student", email: null }
  );
  assert.deepEqual(created.release_issues, releaseIssues);
  part = {
    ...part,
    description: "Fixed description",
    material: { displayName: "6061 Aluminum" },
    microversionId: "after",
  };
  const { invalidateOnshapeCache, cacheKey } =
    await import("../src/lib/onshapeApi/cache");
  invalidateOnshapeCache(
    cacheKey(
      "parts",
      workspace.documentId,
      "w",
      workspace.instanceId,
      workspace.elementId
    )
  );
  await inRequest(sessionRequest("student"), async () =>
    Response.json(await fetchPartsFromOnshape(workspace))
  );
  const patch = endpoint(
    await import("../src/pages/api/kanban/cards/[id]"),
    "PATCH",
    { id: created.id }
  );
  const updated = await patch(
    new Request(`http://localhost/api/kanban/cards/${created.id}`, {
      method: "PATCH",
      headers: {
        ...Object.fromEntries(sessionRequest("student").headers),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quantity_to_make: 8, release_issues: null }),
    }),
    { id: created.id }
  );
  assert.equal(updated.status, 200);
  const persisted = (await readCards()).find(
    (card: { id: string }) => card.id === created.id
  );
  assert.equal(persisted.onshape_microversion_id, "after");
  assert.equal(persisted.quantity_to_make, 8);
  assert.deepEqual(persisted.release_issues, created.release_issues);
});
