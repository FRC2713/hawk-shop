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
  assert.deepEqual((await read()).current_parts, [
    { id: "summary-linked", title: "summary-linked" },
  ]);
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
  assert.equal((await read()).weekly_stats.done, 1);
  assert.equal((await read()).weekly_stats.sent_back, 0);
  await move("review");
  await move("backlog");
  assert.equal((await read()).weekly_stats.done, 1);
  assert.equal((await read()).weekly_stats.sent_back, 1);
  assert.deepEqual((await read()).current_parts, []);
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

test("weekly machine counts use Monday UTC boundaries, count each part once per outcome and exclude other machines", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-11-15T23:59:59.999Z"),
  });
  const cookie = await signIn();
  const response = await endpoint(
    equipment,
    "POST"
  )(
    jsonRequest("/api/equipment", "POST", cookie, {
      id: "weekly-machine",
      name: "Weekly mill",
      processIds: ["process-3d-printing"],
    })
  );
  assert.equal(response.status, 201);
  for (const id of ["weekly-old", "weekly-current", "weekly-future"]) {
    const created = await endpoint(
      cards,
      "POST"
    )(
      jsonRequest("/api/kanban/cards", "POST", cookie, {
        id,
        title: id,
        machineId: "weekly-machine",
        processIds: ["process-3d-printing"],
      })
    );
    assert.equal(created.status, 201);
  }
  const move = async (id: string, column_id: string) => {
    const result = await endpoint(card, "PATCH", { id })(
      jsonRequest(`/api/kanban/cards/${id}`, "PATCH", cookie, { column_id })
    );
    assert.equal(result.status, 200);
  };
  const read = async () => {
    const result = await endpoint(
      equipment,
      "GET"
    )(
      new Request("http://localhost/api/equipment", {
        headers: { Cookie: cookie },
      })
    );
    assert.equal(result.status, 200);
    return (await result.json()).equipment.find(
      (item: { id: string }) => item.id === "weekly-machine"
    );
  };
  await move("weekly-old", "done");
  t.mock.timers.setTime(new Date("2026-11-16T00:00:00.000Z").getTime());
  assert.deepEqual((await read()).weekly_stats, {
    week_start: "2026-11-16T00:00:00.000Z",
    week_end: "2026-11-23T00:00:00.000Z",
    done: 0,
    sent_back: 0,
  });
  await move("weekly-current", "done");
  await move("weekly-current", "review");
  await move("weekly-current", "backlog");
  await move("weekly-current", "review");
  await move("weekly-current", "in-progress");
  await move("weekly-current", "done");
  assert.equal((await read()).weekly_stats.done, 1);
  assert.equal((await read()).weekly_stats.sent_back, 1);
  t.mock.timers.setTime(new Date("2026-11-23T00:00:00.000Z").getTime());
  await move("weekly-future", "done");
  t.mock.timers.setTime(new Date("2026-11-22T23:59:59.999Z").getTime());
  assert.equal((await read()).weekly_stats.done, 1);
  t.mock.timers.setTime(new Date("2026-11-23T00:00:00.000Z").getTime());
  assert.equal((await read()).weekly_stats.done, 1);
  assert.equal((await read()).weekly_stats.sent_back, 0);
});
