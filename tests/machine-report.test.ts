import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-machine-report-"));
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const equipment = await import("../src/pages/api/equipment/index");
const maintenance = await import("../src/pages/api/equipment/[id]/maintenance");

test("a problem report saves the note and verified reporter and rejects empty or anonymous reports", async () => {
  const cookie = await signIn();
  const created = await endpoint(
    equipment,
    "POST"
  )(jsonRequest("/api/equipment", "POST", cookie, { name: "Report printer" }));
  const { equipment: machine } = await created.json();
  const url = `/api/equipment/${machine.id}/maintenance`;
  const post = endpoint(maintenance, "POST", { id: machine.id });
  assert.equal(
    (await post(jsonRequest(url, "POST", "", { note: "Broken" }))).status,
    401
  );
  assert.equal(
    (await post(jsonRequest(url, "POST", cookie, { note: "  " }))).status,
    400
  );
  const reported = await post(
    jsonRequest(url, "POST", cookie, {
      note: "  Nozzle clogged  ",
      reportedBy: "Impostor",
    })
  );
  assert.equal(reported.status, 200);
  const saved = (await reported.json()).equipment;
  assert.equal(saved.status, "maintenance");
  assert.equal(saved.maintenance_note, "Nozzle clogged");
  assert.equal(saved.maintenance_reported_by, "Alice");
  assert.ok(Number.isFinite(Date.parse(saved.maintenance_reported_at)));
  const read = await endpoint(
    equipment,
    "GET"
  )(
    new Request("http://localhost/api/equipment", {
      headers: { Cookie: cookie },
    })
  );
  const item = (await read.json()).equipment.find(
    (item: { id: string }) => item.id === machine.id
  );
  assert.equal(item.machine_status, "needs-maintenance");
  assert.equal(item.maintenance_note, "Nozzle clogged");
  assert.deepEqual(
    [item.weekly_stats.done, item.weekly_stats.sent_back],
    [0, 0]
  );
});

test("completed maintenance date survives reads, later reports and redundant fixes", async () => {
  const cookie = await signIn();
  const created = await endpoint(
    equipment,
    "POST"
  )(
    jsonRequest("/api/equipment", "POST", cookie, {
      name: "Durable maintenance",
    })
  );
  const { equipment: machine } = await created.json();
  const url = `/api/equipment/${machine.id}/maintenance`;
  const fix = async () => {
    const response = await endpoint(maintenance, "DELETE", { id: machine.id })(
      jsonRequest(url, "DELETE", cookie, {})
    );
    assert.equal(response.status, 200);
    return (await response.json()).equipment;
  };
  const report = async () => {
    const response = await endpoint(maintenance, "POST", { id: machine.id })(
      jsonRequest(url, "POST", cookie, { note: "Loose belt" })
    );
    assert.equal(response.status, 200);
    return (await response.json()).equipment;
  };
  assert.equal(machine.last_maintenance_at, null);
  assert.equal((await fix()).last_maintenance_at, null);
  assert.equal((await report()).last_maintenance_at, null);
  const before = Date.now();
  const fixed = await fix();
  assert.ok(Date.parse(fixed.last_maintenance_at) >= before);
  assert.ok(Date.parse(fixed.last_maintenance_at) <= Date.now());
  assert.equal(fixed.maintenance_reported_at, null);
  assert.equal(fixed.maintenance_note, null);
  assert.equal((await fix()).last_maintenance_at, fixed.last_maintenance_at);
  assert.equal((await report()).last_maintenance_at, fixed.last_maintenance_at);
  const read = await endpoint(
    equipment,
    "GET"
  )(
    new Request("http://localhost/api/equipment", {
      headers: { Cookie: cookie },
    })
  );
  assert.equal(
    (await read.json()).equipment.find(
      (item: { id: string }) => item.id === machine.id
    ).last_maintenance_at,
    fixed.last_maintenance_at
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fixedAgain = await fix();
  assert.ok(fixedAgain.last_maintenance_at > fixed.last_maintenance_at);
});
