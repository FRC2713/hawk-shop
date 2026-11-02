import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { onshapePartsQuery } from "../app/lib/api/onshape";
import { updatePartNumber } from "../app/lib/api/partActions";

const scope = {
  documentId: "doc",
  instanceType: "w",
  instanceId: "workspace",
  elementId: "studio",
};
test("browser confirmed edit refreshes both parts variants and preserves unrelated query data", async (t) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  let saved = false;
  let partReads = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/mfg/parts/actions") {
        const form = init?.body as FormData;
        assert.equal(form.get("partNumber"), "new");
        saved = true;
        return Response.json({ success: true });
      }
      partReads++;
      return Response.json([{ partNumber: saved ? "new" : "old" }]);
    }
  );
  const variants = [
    onshapePartsQuery(scope),
    onshapePartsQuery(scope, { withThumbnails: true }),
  ];
  const unrelated = onshapePartsQuery({ ...scope, elementId: "other" });
  await Promise.all([...variants, unrelated].map((q) => client.fetchQuery(q)));
  const subscriptions = variants.map((query) =>
    new QueryObserver(client, query).subscribe(() => {})
  );
  await updatePartNumber(
    { ...scope, partId: "part", partNumber: "new" },
    client
  );
  for (const query of variants)
    assert.equal(client.getQueryData(query.queryKey)?.[0]?.partNumber, "new");
  const results = await Promise.all(variants.map((q) => client.fetchQuery(q)));
  for (const result of results) assert.equal(result[0]?.partNumber, "new");
  assert.equal((await client.fetchQuery(unrelated))[0]?.partNumber, "old");
  assert.equal(partReads, 5);
  subscriptions.forEach((unsubscribe) => unsubscribe());
  client.clear();
});

test("browser rejection returns its inline error and leaves cached parts reusable without retrying", async (t) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  let writes = 0;
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("/actions")) {
      writes++;
      return Response.json(
        { success: false, error: "Workspace locked" },
        { status: 400 }
      );
    }
    reads++;
    return Response.json([{ partNumber: "old" }]);
  });
  const query = onshapePartsQuery(scope);
  await client.fetchQuery(query);
  assert.deepEqual(
    await updatePartNumber(
      { ...scope, partId: "part", partNumber: "requested" },
      client
    ),
    { success: false, error: "Workspace locked" }
  );
  assert.equal((await client.fetchQuery(query))[0]?.partNumber, "old");
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  client.clear();
});
