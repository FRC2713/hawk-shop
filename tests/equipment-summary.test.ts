import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(
  path.join(tmpdir(), "hawk-equipment-summary-")
);
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const equipment = await import("../src/pages/api/equipment/index");
const cards = await import("../src/pages/api/kanban/cards/index");
const card = await import("../src/pages/api/kanban/cards/[id]");
const maintenance = await import("../src/pages/api/equipment/[id]/maintenance");

test("equipment list derives idle, running and maintenance status with the same Backlog queue as the machine endpoint", async () => {
  const cookie = await signIn();
  const created = await endpoint(
    equipment,
    "POST"
  )(
    jsonRequest("/api/equipment", "POST", cookie, {
      name: "Summary printer",
      processIds: ["process-3d-printing"],
    })
  );
  const { equipment: machine } = await created.json();
  const read = async () => {
    const response = await endpoint(
      equipment,
      "GET"
    )(
      new Request("http://localhost/api/equipment", {
        headers: { Cookie: cookie },
      })
    );
    assert.equal(response.status, 200);
    return (await response.json()).equipment.find(
      (item: { id: string }) => item.id === machine.id
    );
  };
  assert.equal((await read()).machine_status, "idle");
  for (const [id, machineId] of [
    ["summary-linked", machine.id],
    ["summary-waiting", undefined],
  ]) {
    const response = await endpoint(
      cards,
      "POST"
    )(
      jsonRequest("/api/kanban/cards", "POST", cookie, {
        id,
        title: id,
        machineId,
        processIds: ["process-3d-printing"],
      })
    );
    assert.equal(response.status, 201);
  }
  assert.equal((await read()).queue_size, 2);
  const move = async (column_id: string) => {
    const response = await endpoint(card, "PATCH", { id: "summary-linked" })(
      jsonRequest("/api/kanban/cards/summary-linked", "PATCH", cookie, {
        column_id,
      })
    );
    assert.equal(response.status, 200);
  };
  await move("in-progress");
  assert.equal((await read()).machine_status, "running");
  assert.equal((await read()).queue_size, 1);
  await endpoint(maintenance, "POST", { id: machine.id })(
    jsonRequest(`/api/equipment/${machine.id}/maintenance`, "POST", cookie, {
      note: "Belt",
    })
  );
  assert.equal((await read()).machine_status, "needs-maintenance");
  await endpoint(maintenance, "DELETE", { id: machine.id })(
    jsonRequest(
      `/api/equipment/${machine.id}/maintenance`,
      "DELETE",
      cookie,
      {}
    )
  );
  assert.equal((await read()).machine_status, "running");
  await move("review");
  assert.equal((await read()).machine_status, "idle");
  await move("done");
  assert.equal((await read()).machine_status, "idle");
  const queueRoute = await import("../src/pages/api/equipment/[id]/queue");
  const queue = await endpoint(queueRoute, "GET", { id: machine.id })(
    new Request(`http://localhost/api/equipment/${machine.id}/queue`, {
      headers: { Cookie: cookie },
    })
  );
  assert.equal((await read()).queue_size, (await queue.json()).cards.length);
  assert.equal(
    (
      await endpoint(
        equipment,
        "GET"
      )(new Request("http://localhost/api/equipment"))
    ).status,
    401
  );
});
