import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-roster-"));
process.env.APP_URL = "http://localhost";
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const roster = await import("../src/pages/api/processes/[id]/roster");
const alice = await signIn();
await signIn("bob@example.com", "bob");
const ALICE = "slack:TRHR:UALICE";
const BOB = "slack:TRHR:UBOB";
const PRINT = "process-3d-printing";
const MILL = "process-material-processing";
async function list(id = PRINT, cookie = alice) {
  return endpoint(roster, "GET", { id })(
    new Request(`http://localhost/api/processes/${id}/roster`, {
      headers: { Cookie: cookie },
    })
  );
}
async function change(
  method: string,
  userId: string,
  id = PRINT,
  cookie = alice
) {
  return endpoint(roster, method, { id })(
    jsonRequest(`/api/processes/${id}/roster`, method, cookie, { userId })
  );
}
async function ids(id = PRINT) {
  const response = await list(id);
  assert.equal(response.status, 200);
  return (await response.json()).members.map((m: any) => m.onshape_user_id);
}

test("members can pick, list and remove today's process roster, with auth and input checks", async () => {
  assert.equal((await list(PRINT, "")).status, 401);
  assert.equal((await change("POST", BOB, PRINT, "")).status, 401);
  assert.equal((await change("DELETE", BOB, PRINT, "")).status, 401);
  assert.equal((await list("missing")).status, 400);
  assert.equal((await change("POST", "missing")).status, 400);
  assert.deepEqual(await ids(), []);
  assert.equal((await change("POST", BOB)).status, 200);
  assert.equal((await change("POST", BOB)).status, 200);
  assert.deepEqual(await ids(), [BOB]);
  assert.deepEqual(await ids(MILL), []);
  assert.equal((await change("DELETE", BOB)).status, 200);
  assert.deepEqual(await ids(), []);
});

test("shop days roll at the local cutoff, including DST and configured settings", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-11-01T07:59:59Z"),
  });
  assert.equal((await change("POST", BOB)).status, 200);
  assert.equal((await (await list()).json()).shop_day, "2026-10-31");
  t.mock.timers.setTime(new Date("2026-11-01T08:00:00Z").getTime());
  assert.equal((await (await list()).json()).shop_day, "2026-11-01");
  assert.deepEqual(await ids(), []);
  process.env.SHOP_TIMEZONE = "America/Los_Angeles";
  process.env.SHOP_DAY_CUTOFF_HOUR = "4";
  try {
    t.mock.timers.setTime(new Date("2026-11-02T11:59:59Z").getTime());
    await change("POST", ALICE);
    assert.equal((await (await list()).json()).shop_day, "2026-11-01");
    t.mock.timers.setTime(new Date("2026-11-02T12:00:00Z").getTime());
    assert.equal((await (await list()).json()).shop_day, "2026-11-02");
    assert.deepEqual(await ids(), []);
  } finally {
    delete process.env.SHOP_TIMEZONE;
    delete process.env.SHOP_DAY_CUTOFF_HOUR;
  }
});

const cardList = await import("../src/pages/api/kanban/cards/index");
const equipmentList = await import("../src/pages/api/equipment/index");
const claimRoute = await import("../src/pages/api/kanban/cards/[id]/claim");
const doneRoute = await import("../src/pages/api/kanban/cards/[id]/done");

test("phone claims and done add members only to card processes supported by its machine", async () => {
  const machineResponse = await endpoint(
    equipmentList,
    "POST"
  )(
    jsonRequest("/api/equipment", "POST", alice, {
      name: "Mixed machine",
      processIds: [PRINT],
    })
  );
  assert.equal(machineResponse.status, 201);
  const machineId = (await machineResponse.json()).equipment.id;
  const release = await endpoint(
    cardList,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", alice, {
      id: "roster-part",
      title: "Bracket",
      processIds: [PRINT, MILL],
      machineId,
    })
  );
  assert.equal(release.status, 201);
  const claimed = await endpoint(claimRoute, "POST", { id: "roster-part" })(
    jsonRequest("/api/kanban/cards/roster-part/claim", "POST", alice, {
      userId: BOB,
      device_id: "forged",
    })
  );
  assert.equal(claimed.status, 200);
  assert.deepEqual(await ids(), [BOB]);
  assert.deepEqual(await ids(MILL), []);
  await change("DELETE", BOB);
  const done = await endpoint(doneRoute, "POST", { id: "roster-part" })(
    jsonRequest("/api/kanban/cards/roster-part/done", "POST", alice, {})
  );
  assert.equal(done.status, 200);
  assert.deepEqual(await ids(), [ALICE]);
  assert.deepEqual(await ids(MILL), []);
});

test("self claims without a machine use the card's processes and a refused claim adds nobody", async () => {
  await change("DELETE", ALICE);
  await change("DELETE", BOB);
  await change("DELETE", ALICE, MILL);
  await change("DELETE", BOB, MILL);
  const released = await endpoint(
    cardList,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", alice, {
      id: "roster-process-part",
      title: "Process part",
      processIds: [PRINT, MILL],
    })
  );
  assert.equal(released.status, 201);
  const bob = await signIn("bob@example.com", "bob");
  const claimed = await endpoint(claimRoute, "POST", {
    id: "roster-process-part",
  })(
    jsonRequest("/api/kanban/cards/roster-process-part/claim", "POST", bob, {})
  );
  assert.equal(claimed.status, 200);
  assert.deepEqual(await ids(), [BOB]);
  assert.deepEqual(await ids(MILL), [BOB]);
  const refused = await endpoint(claimRoute, "POST", {
    id: "roster-process-part",
  })(
    jsonRequest(
      "/api/kanban/cards/roster-process-part/claim",
      "POST",
      alice,
      {}
    )
  );
  assert.equal(refused.status, 409);
  assert.deepEqual(await ids(), [BOB]);
  assert.deepEqual(await ids(MILL), [BOB]);
});
