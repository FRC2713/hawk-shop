import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, after } from "node:test";
import { createHash, randomBytes } from "node:crypto";

const directory = mkdtempSync(path.join(tmpdir(), "hawk-shop-mcp-"));
process.env.DATA_DIR = directory;
process.env.APP_URL = "https://shop.suite.test";
process.env.MCP_OAUTH_ENABLED = "true";
process.env.HAWK_SUITE_TRUST_PROXY = "true";
process.env.HAWK_SUITE_TEAM_ID = "TRHR";
process.env.HAWK_SUITE_ISSUER = "https://apps.suite.test/";
const { handleMcp } = await import("../src/server/mcp/server");
const { upsertUser } = await import("../src/server/db/users");
const { createCard, getCards } = await import("../src/server/kanbanApi/cards");
const { createEquipment } =
  await import("../src/server/equipmentApi/equipment");
const { db } = await import("../src/server/db/client");
const { equipment, statusHistory } = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const actor = {
  onshape_user_id: "slack:TRHR:UALICE",
  email: null,
  name: "Alice",
};
await upsertUser(actor.onshape_user_id, "Alice");
const other = "slack:TRHR:UBOB";
await upsertUser(other, "Bob");
after(() => rmSync(directory, { recursive: true, force: true }));

const {
  insertClient,
  insertPending,
  takePending,
  approvePending,
  exchangeCode,
} = await import("../src/server/oauth/store");
async function token(
  scopes: ("shop:read" | "shop:manage")[] = ["shop:read", "shop:manage"],
  subject = actor.onshape_user_id,
  now = Date.now()
) {
  const client = insertClient(
    "Test client",
    ["https://client.test/callback"],
    now
  );
  const verifier = randomBytes(32).toString("base64url");
  const pending = insertPending(
    {
      clientId: client.clientId,
      subject,
      redirectUri: client.redirectUris[0],
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      scope: scopes,
      state: null,
    },
    now
  );
  const code = approvePending(takePending(pending, subject, now)!, now);
  const result = exchangeCode(
    {
      code,
      clientId: client.clientId,
      redirectUri: client.redirectUris[0],
      verifier,
    },
    now
  );
  if ("error" in result) throw new Error(result.description);
  return result.access_token;
}
const writer = await token();
const reader = await token(["shop:read"]);
function request(
  body: unknown,
  bearer: string | null = writer,
  extra: Record<string, string> = {},
  method = "POST"
) {
  return new Request("http://localhost/mcp", {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...extra,
    },
    ...(["GET", "DELETE"].includes(method)
      ? {}
      : { body: JSON.stringify(body) }),
  });
}
async function rpc(method: string, params: unknown = {}, bearer = writer) {
  const response = await handleMcp(
    request({ jsonrpc: "2.0", id: 1, method, params }, bearer)
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return await response.json();
}
async function call(
  name: string,
  args: Record<string, unknown>,
  bearer = writer
) {
  return (await rpc("tools/call", { name, arguments: args }, bearer)).result;
}
function value(result: any) {
  return result.structuredContent.result;
}

test("MCP requires OAuth credentials and enforces origin", async () => {
  process.env.MCP_OAUTH_ENABLED = "false";
  assert.equal((await handleMcp(request({}))).status, 404);
  process.env.MCP_OAUTH_ENABLED = "true";
  assert.equal(
    (
      await handleMcp(
        request({}, null, { "X-Token-Subject": actor.onshape_user_id })
      )
    ).status,
    401
  );
  for (const invalid of [
    "bad-token",
    "a.b.c",
    "hsk_at_" + "A".repeat(43),
    await token(undefined, "unknown"),
    await token(undefined, actor.onshape_user_id, Date.now() - 3600001),
  ]) {
    const response = await handleMcp(request({}, invalid));
    assert.equal(response.status, 401);
    assert.match(
      response.headers.get("www-authenticate")!,
      /oauth-protected-resource/
    );
    assert.match(
      response.headers.get("www-authenticate")!,
      /error="invalid_token"/
    );
  }
  assert.equal(
    (
      await handleMcp(
        request({}, writer, { Origin: "https://attacker.example" })
      )
    ).status,
    403
  );
  assert.equal((await handleMcp(request({}, writer, {}, "GET"))).status, 405);
  assert.equal(
    (await handleMcp(request({}, writer, { "Content-Type": "text/plain" })))
      .status,
    415
  );
});

test("initialization, discovery and read-only scope work across stateless requests", async () => {
  const init = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.result.serverInfo.name, "hawk-shop");
  const tools = (await rpc("tools/list", {}, reader)).result.tools;
  assert.ok(tools.some((t: any) => t.name === "list_released_work"));
  assert.ok(!tools.some((t: any) => t.name === "assign_machine"));
  assert.ok(tools.every((t: any) => t.annotations.readOnlyHint));
  const denied = await call(
    "assign_machine",
    { card_ids: ["does-not-exist"], machine_id: null },
    reader
  );
  assert.ok(denied.isError);
  const config = value(await call("list_shop_configuration", {}, reader));
  assert.ok(config.stations.some((p: any) => p.id === "process-3d-printing"));
  assert.ok(config.statuses.some((s: any) => s.id === "backlog"));
  const members = value(await call("list_members", {}, reader));
  assert.ok(members.items.some((m: any) => m.id === other));
  assert.ok(members.items.every((m: any) => !Object.hasOwn(m, "email")));
});

test("released work filtering and bounded pagination never call CAD", async () => {
  await createCard(
    {
      id: "read-a",
      title: "Intake plate",
      content: "Keep tolerance",
      processIds: ["process-cnc-milling"],
    },
    actor
  );
  await createCard(
    {
      id: "read-b",
      title: "Printed bracket",
      processIds: ["process-3d-printing"],
    },
    actor
  );
  const result = value(
    await call("list_released_work", { query: "tolerance", limit: 1 })
  );
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, "read-a");
  const first = value(await call("list_released_work", { limit: 1 }));
  assert.equal(first.next_offset, 1);
  const second = value(
    await call("list_released_work", { limit: 1, offset: 1 })
  );
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.ok((await call("list_released_work", { limit: 101 })).isError);
  assert.ok(
    (await call("list_released_work", { invented_filter: true })).isError
  );
  assert.ok((await call("get_released_part", { card_id: "missing" })).isError);
  const detail = value(await call("get_released_part", { card_id: "read-a" }));
  assert.equal(detail.card.onshape_material, null);
  assert.equal(detail.history[0].actor_id, actor.onshape_user_id);
});

test("machine assignments, priorities and station claims preserve workflow constraints", async () => {
  const printer = await createEquipment({
    name: "MCP printer",
    processIds: ["process-3d-printing"],
  });
  for (const id of ["queue-a", "queue-b"])
    await createCard(
      { id, title: id, processIds: ["process-3d-printing"] },
      actor
    );
  // Incompatible assignments fail without changing any part.
  const incompatible = await call("assign_machine", {
    card_ids: ["queue-a", "read-a"],
    machine_id: printer.id,
  });
  assert.ok(incompatible.isError);
  assert.match(incompatible.content[0].text, /machine_lacks_process/);
  assert.equal(
    (await getCards()).cards.find((c) => c.id === "queue-a")!.machine_id,
    null
  );
  assert.ok(
    !(
      await call("assign_machine", {
        card_ids: ["queue-a"],
        machine_id: printer.id,
      })
    ).isError
  );
  const prioritized = value(
    await call("prioritize_machine_queue", {
      machine_id: printer.id,
      card_ids: ["queue-b", "queue-a"],
    })
  );
  assert.deepEqual(
    prioritized.cards.slice(0, 2).map((c: any) => c.id),
    ["queue-b", "queue-a"]
  );
  assert.ok(
    (
      await call("prioritize_machine_queue", {
        machine_id: printer.id,
        card_ids: ["read-a"],
      })
    ).isError
  );
  const queue = value(
    await call("get_machine_queue", { machine_id: printer.id, limit: 1 })
  );
  assert.equal(queue.items[0].id, "queue-b");
  const station = value(
    await call("get_station", { process_id: "process-3d-printing" })
  );
  assert.ok(station.items.some((c: any) => c.id === "queue-b"));
  assert.ok(!station.items.some((c: any) => c.id === "queue-a"));
  db.update(equipment)
    .set({ status: "maintenance" })
    .where(eq(equipment.id, printer.id))
    .run();
  const maintenance = await call("claim_part", {
    card_id: "queue-b",
    machine_id: printer.id,
  });
  assert.ok(maintenance.isError);
  assert.match(maintenance.content[0].text, /machine_needs_maintenance/);
  db.update(equipment)
    .set({ status: "available" })
    .where(eq(equipment.id, printer.id))
    .run();
  const claimed = value(
    await call("claim_part", {
      card_id: "queue-b",
      machine_id: printer.id,
      user_id: other,
    })
  );
  assert.equal(claimed.assignee, other);
  assert.equal(claimed.column_id, "in-progress");
  assert.ok((await call("claim_part", { card_id: "queue-b" })).isError);
  assert.ok(
    (await call("assign_machine", { card_ids: ["queue-b"], machine_id: null }))
      .isError
  );
  const history = db
    .select()
    .from(statusHistory)
    .where(eq(statusHistory.card_id, "queue-b"))
    .all();
  assert.equal(history.at(-1)!.actor_id, other);
  assert.equal(history.at(-1)!.device_id, actor.onshape_user_id);
  assert.equal(
    value(await call("mark_part_done", { card_id: "queue-b" })).column_id,
    "review"
  );
  assert.ok(
    (await call("send_part_back", { card_id: "queue-b", reason: " " })).isError
  );
  assert.equal(
    value(
      await call("send_part_back", {
        card_id: "queue-b",
        reason: "Check the hole",
      })
    ).column_id,
    "in-progress"
  );
  await call("mark_part_done", { card_id: "queue-b" });
  assert.equal(
    value(await call("approve_part", { card_id: "queue-b" })).column_id,
    "done"
  );
  assert.equal(
    value(await call("list_released_work", { query: "queue-b" })).total,
    0
  );
  assert.equal(
    value(
      await call("list_released_work", { query: "queue-b", include_done: true })
    ).total,
    1
  );
});

test("malformed and oversized streamed requests are rejected", async () => {
  const malformed = request({});
  const response = await handleMcp(new Request(malformed, { body: "{" }));
  assert.equal(response.status, 400);
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(256 * 1024 + 1));
      controller.close();
    },
  });
  const large = new Request("http://localhost/mcp", {
    method: "POST",
    headers: malformed.headers,
    body: oversized,
    duplex: "half",
  } as RequestInit);
  assert.equal((await handleMcp(large)).status, 413);
});
