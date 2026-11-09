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
