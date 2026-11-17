import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-claim-"));
process.env.APP_URL = "http://localhost";

const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cardList = await import("../src/pages/api/kanban/cards/index");
const cardDetail = await import("../src/pages/api/kanban/cards/[id]");
const claimRoute = await import("../src/pages/api/kanban/cards/[id]/claim");
const alice = await signIn();
const ALICE = "slack:TRHR:UALICE";

async function release(id: string, fields: Record<string, unknown> = {}) {
  const response = await endpoint(
    cardList,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", alice, {
      id,
      title: id,
      ...fields,
    })
  );
  assert.equal(response.status, 201, await response.clone().text());
}

async function read(id: string) {
  const response = await endpoint(cardDetail, "GET", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      headers: { Cookie: alice },
    })
  );
  assert.equal(response.status, 200);
  return (await response.json()).card;
}

async function move(id: string, column_id: string) {
  const response = await endpoint(cardDetail, "PATCH", { id })(
    jsonRequest(`/api/kanban/cards/${id}`, "PATCH", alice, { column_id })
  );
  assert.equal(response.status, 200);
}

async function claim(id: string, body: unknown = {}, cookie = alice) {
  const response = await endpoint(claimRoute, "POST", { id })(
    jsonRequest(`/api/kanban/cards/${id}/claim`, "POST", cookie, body)
  );
  return { status: response.status, body: await response.json() };
}

test("claiming a Backlog part makes the member its assignee and moves it to In Progress", async () => {
  await release("claim-basic");
  const { status, body } = await claim("claim-basic");
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.assignee, ALICE);
  assert.equal(body.card.column_id, "in-progress");
  const card = await read("claim-basic");
  assert.equal(card.assignee, ALICE);
  assert.equal(card.column_id, "in-progress");
});

test("claiming for another member makes that member the assignee", async () => {
  await signIn("bob@example.com", "bob");
  await release("claim-for-bob");
  const { status, body } = await claim("claim-for-bob", {
    userId: "slack:TRHR:UBOB",
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.assignee, "slack:TRHR:UBOB");
  assert.equal(body.card.column_id, "in-progress");
});

test("claiming a part someone else claimed first is a conflict that changes nothing", async () => {
  const bob = await signIn("bob@example.com", "bob");
  await release("claim-race");
  assert.equal((await claim("claim-race", {}, bob)).status, 200);
  const { status, body } = await claim("claim-race");
  assert.equal(status, 409);
  assert.equal(body.code, "already_claimed");
  assert.deepEqual(body.cardIds, ["claim-race"]);
  const card = await read("claim-race");
  assert.equal(card.assignee, "slack:TRHR:UBOB");
  assert.equal(card.status_history.length, 2);
});

test("claiming a part you already claimed again succeeds without another move", async () => {
  await release("claim-twice");
  assert.equal((await claim("claim-twice")).status, 200);
  const { status, body } = await claim("claim-twice");
  assert.equal(status, 200);
  assert.equal(body.card.assignee, ALICE);
  assert.equal((await read("claim-twice")).status_history.length, 2);
});

test("a part in Review or Done can't be claimed", async () => {
  await release("claim-review");
  await move("claim-review", "review");
  const { status, body } = await claim("claim-review");
  assert.equal(status, 409);
  assert.equal(body.code, "wrong_status");
  assert.equal((await read("claim-review")).assignee, null);
});

const equipmentList = await import("../src/pages/api/equipment/index");
const maintenance = await import("../src/pages/api/equipment/[id]/maintenance");
const processQueue = await import("../src/pages/api/processes/[id]/queue");
const PRINTING = "process-3d-printing";

async function addMachine(name: string, processIds: string[]) {
  const response = await endpoint(
    equipmentList,
    "POST"
  )(jsonRequest("/api/equipment", "POST", alice, { name, processIds }));
  assert.equal(response.status, 201);
  return (await response.json()).equipment.id as string;
}

async function processQueueIds(id: string) {
  const response = await endpoint(processQueue, "GET", { id })(
    new Request(`http://localhost/api/processes/${id}/queue`, {
      headers: { Cookie: alice },
    })
  );
  return ((await response.json()).cards as Array<{ id: string }>).map(
    (card) => card.id
  );
}

test("claiming a process-queue part at a machine links that machine", async () => {
  const printer = await addMachine("Prusa XL", [PRINTING]);
  await release("claim-at-printer", { processIds: [PRINTING] });
  assert.ok((await processQueueIds(PRINTING)).includes("claim-at-printer"));
  const { status, body } = await claim("claim-at-printer", {
    machineId: printer,
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.machine_id, printer);
  assert.equal(body.card.column_id, "in-progress");
  assert.ok(!(await processQueueIds(PRINTING)).includes("claim-at-printer"));
  // One claim is one move.
  assert.equal((await read("claim-at-printer")).status_history.length, 2);
});

test("claiming at a machine obeys the maintenance and process rules", async () => {
  const laser = await addMachine("Laser", ["process-material-processing"]);
  await release("claim-wrong-process", { processIds: [PRINTING] });
  let refused = await claim("claim-wrong-process", { machineId: laser });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "machine_lacks_process");

  const printer = await addMachine("Bambu", [PRINTING]);
  const flagged = await endpoint(maintenance, "POST", { id: printer })(
    jsonRequest(`/api/equipment/${printer}/maintenance`, "POST", alice, {
      note: "Bed warped",
    })
  );
  assert.equal(flagged.status, 200);
  refused = await claim("claim-wrong-process", { machineId: printer });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "machine_needs_maintenance");

  const card = await read("claim-wrong-process");
  assert.equal(card.assignee, null);
  assert.equal(card.machine_id, null);
  assert.equal(card.column_id, "backlog");
});

test("claiming a part at a machine other than the one it is assigned to is a conflict", async () => {
  const mine = await addMachine("Mk3 A", [PRINTING]);
  const other = await addMachine("Mk3 B", [PRINTING]);
  await release("claim-other-machine", {
    processIds: [PRINTING],
    machineId: mine,
  });
  const refused = await claim("claim-other-machine", { machineId: other });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "other_machine");
  const claimed = await claim("claim-other-machine", { machineId: mine });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.card.machine_id, mine);
});

const unclaimRoute = await import("../src/pages/api/kanban/cards/[id]/unclaim");
const machineQueue = await import("../src/pages/api/equipment/[id]/queue");

async function unclaim(id: string) {
  const response = await endpoint(unclaimRoute, "POST", { id })(
    jsonRequest(`/api/kanban/cards/${id}/unclaim`, "POST", alice, {})
  );
  return { status: response.status, body: await response.json() };
}

test("unclaiming clears the assignee and returns the part to Backlog on its machine", async () => {
  const printer = await addMachine("Voron", [PRINTING]);
  await release("unclaim-me", { processIds: [PRINTING] });
  assert.equal((await claim("unclaim-me", { machineId: printer })).status, 200);
  const { status, body } = await unclaim("unclaim-me");
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.card.assignee, null);
  assert.equal(body.card.column_id, "backlog");
  assert.equal(body.card.machine_id, printer);
  const queue = await endpoint(machineQueue, "GET", { id: printer })(
    new Request(`http://localhost/api/equipment/${printer}/queue`, {
      headers: { Cookie: alice },
    })
  );
  // Back at the head of its machine's own parts, not in the process queue.
  assert.equal((await queue.json()).cards[0].id, "unclaim-me");
  assert.ok(!(await processQueueIds(PRINTING)).includes("unclaim-me"));
});

test("unclaiming a part nobody claimed, or one in Review, is a conflict", async () => {
  await release("unclaim-unclaimed");
  let refused = await unclaim("unclaim-unclaimed");
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "not_claimed");

  await release("unclaim-review");
  await claim("unclaim-review");
  await move("unclaim-review", "review");
  refused = await unclaim("unclaim-review");
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "wrong_status");
  assert.equal((await read("unclaim-review")).assignee, ALICE);
});

const columnConfig = await import("../src/pages/api/kanban/config/index");

async function saveColumns(columns: unknown[]) {
  const response = await endpoint(
    columnConfig,
    "PUT"
  )(jsonRequest("/api/kanban/config", "PUT", alice, { columns }));
  return { status: response.status, body: await response.json() };
}

test("Edit Columns can rename and add to the workflow columns but not delete them", async () => {
  const workflow = [
    { id: "backlog", title: "Queued", position: 0 },
    { id: "in-progress", title: "Making", position: 1 },
    { id: "review", title: "Check", position: 2 },
    { id: "done", title: "Done", position: 3 },
  ];
  assert.equal(
    (
      await saveColumns([
        ...workflow,
        { id: "paint", title: "Paint", position: 4 },
      ])
    ).status,
    200
  );
  const refused = await saveColumns(
    workflow.filter((column) => column.id !== "review")
  );
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Check/);
  // Claiming still lands in the renamed column.
  await release("claim-renamed");
  assert.equal(
    (await claim("claim-renamed")).body.card.column_id,
    "in-progress"
  );
  assert.equal((await saveColumns(workflow.slice(0, 4))).status, 200);
});

test("claiming a missing card answers 404", async () => {
  assert.equal((await claim("no-such-card")).status, 404);
});

test("claiming for someone who has never signed in is rejected and changes nothing", async () => {
  await release("claim-for-nobody");
  const { status } = await claim("claim-for-nobody", {
    userId: "slack:TRHR:UNOBODY",
  });
  assert.equal(status, 400);
  const card = await read("claim-for-nobody");
  assert.equal(card.assignee, null);
  assert.equal(card.column_id, "backlog");
});

test("a phone's stale machine intent cannot claim assigned work after maintenance starts", async () => {
  const printer = await addMachine("QR printer", [PRINTING]);
  await release("qr-stale-maintenance", {
    processIds: [PRINTING],
    machineId: printer,
  });
  const flagged = await endpoint(maintenance, "POST", { id: printer })(
    jsonRequest(`/api/equipment/${printer}/maintenance`, "POST", alice, {
      note: "Stopped after QR was opened",
    })
  );
  assert.equal(flagged.status, 200);
  const refused = await claim("qr-stale-maintenance", { machineId: printer });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "machine_needs_maintenance");
  const card = await read("qr-stale-maintenance");
  assert.equal(card.assignee, null);
  assert.equal(card.column_id, "backlog");
  assert.equal(card.status_history.length, 1);
});
