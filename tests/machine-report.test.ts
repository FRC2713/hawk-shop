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
