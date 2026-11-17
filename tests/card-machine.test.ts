import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-card-machine-"));
process.env.APP_URL = "http://localhost";

// A database from before cards linked to equipment, with machine text typed
// the way people typed it.
function upgradeFromBeforeMachineLinks() {
  const folder = mkdtempSync(path.join(tmpdir(), "hawk-card-machine-sql-"));
  try {
    cpSync("drizzle", folder, { recursive: true });
    const journalPath = path.join(folder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const link = journal.entries.findIndex((entry: { tag: string }) =>
      entry.tag.endsWith("_card_machine_link")
    );
    assert.ok(link > 0, "the machine link migration exists");
    writeFileSync(
      journalPath,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, link) })
    );
    const sqlite = new Database(
      path.join(process.env.DATA_DIR!, "hawk-shop.db")
    );
    migrate(drizzle(sqlite), { migrationsFolder: folder });
    const now = "2026-01-02T03:04:05.000Z";
    const equipment = sqlite.prepare(
      "INSERT INTO equipment (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
    );
    equipment.run("eq-laser", "Glowforge Laser", now, now);
    equipment.run("eq-router", "CNC Router", now, now);
    const card = sqlite.prepare(
      "INSERT INTO kanban_cards (id, column_id, title, machine, date_created, date_updated) VALUES (?, 'backlog', ?, ?, ?, ?)"
    );
    card.run("legacy-laser", "Side plate", "glowforge laser", now, now);
    card.run("legacy-router", "Gusset", "CNC Router", now, now);
    card.run("legacy-lathe", "Axle", "Old lathe", now, now);
    card.run("legacy-tbd", "Spacer", "TBD", now, now);
    card.run("legacy-none", "Shim", null, now, now);
    sqlite.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
upgradeFromBeforeMachineLinks();

const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const list = await import("../src/pages/api/kanban/cards/index");
const detail = await import("../src/pages/api/kanban/cards/[id]");
const equipmentList = await import("../src/pages/api/equipment/index");
const equipmentItem = await import("../src/pages/api/equipment/[id]");
const cookie = await signIn();

async function read(id: string) {
  const response = await endpoint(detail, "GET", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      headers: { Cookie: cookie },
    })
  );
  assert.equal(response.status, 200);
  return (await response.json()).card;
}
async function readAll() {
  const response = await endpoint(
    list,
    "GET"
  )(
    new Request("http://localhost/api/kanban/cards", {
      headers: { Cookie: cookie },
    })
  );
  assert.equal(response.status, 200);
  return (await response.json()).cards as Array<Record<string, any>>;
}

test("upgrading links cards whose machine text names equipment, ignoring case", async () => {
  const cards = new Map((await readAll()).map((card) => [card.id, card]));
  assert.equal(cards.get("legacy-laser")!.machine_id, "eq-laser");
  assert.deepEqual(
    {
      id: cards.get("legacy-laser")!.linked_machine.id,
      name: cards.get("legacy-laser")!.linked_machine.name,
    },
    { id: "eq-laser", name: "Glowforge Laser" }
  );
  assert.equal(cards.get("legacy-router")!.machine_id, "eq-router");
  for (const id of ["legacy-laser", "legacy-router"])
    assert.equal(
      cards.get(id)!.machine,
      null,
      `${id}'s linked text is settled`
    );
  for (const id of ["legacy-lathe", "legacy-tbd", "legacy-none"]) {
    assert.equal(cards.get(id)!.machine_id, null, id);
    assert.equal(cards.get(id)!.linked_machine, null, id);
  }
  assert.equal(
    (await read("legacy-lathe")).machine,
    "Old lathe",
    "unmatched text stays visible so a mentor can fix it"
  );
});

async function patch(id: string, body: unknown) {
  const response = await endpoint(detail, "PATCH", { id })(
    jsonRequest(`/api/kanban/cards/${id}`, "PATCH", cookie, body)
  );
  return { status: response.status, body: await response.json() };
}
async function addEquipment(name: string) {
  const response = await endpoint(
    equipmentList,
    "POST"
  )(jsonRequest("/api/equipment", "POST", cookie, { name }));
  assert.equal(response.status, 201);
  return (await response.json()).equipment;
}

test("a member picks a machine for a card, then clears it", async () => {
  const printer = await addEquipment("Bambu X1");
  const picked = await patch("legacy-lathe", { machine_id: printer.id });
  assert.equal(picked.status, 200);
  assert.equal(picked.body.card.machine_id, printer.id);
  assert.equal(picked.body.card.linked_machine.name, "Bambu X1");
  const card = await read("legacy-lathe");
  assert.equal(card.linked_machine.name, "Bambu X1");
  assert.equal(card.machine, null, "a picked machine replaces the old text");
  const listed = (await readAll()).find((row) => row.id === "legacy-lathe")!;
  assert.equal(listed.linked_machine.id, printer.id);

  const cleared = await patch("legacy-lathe", { machine_id: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.card.machine_id, null);
  assert.equal(cleared.body.card.linked_machine, null);
  assert.equal((await read("legacy-lathe")).machine, null);
});

test("picking equipment that doesn't exist is rejected and changes nothing", async () => {
  const rejected = await patch("legacy-laser", { machine_id: "eq-missing" });
  assert.equal(rejected.status, 400);
  assert.equal((await read("legacy-laser")).machine_id, "eq-laser");
  const response = await endpoint(
    list,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", cookie, {
      title: "Orphan",
      machineId: "eq-missing",
    })
  );
  assert.equal(response.status, 400);
});

test("machine text is no longer written", async () => {
  await patch("legacy-none", { machine: "Typed router" });
  const card = await read("legacy-none");
  assert.equal(card.machine, null);
  assert.equal(card.linked_machine, null);
  const response = await endpoint(
    list,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", cookie, {
      title: "Bracket",
      machine: "TBD",
      machineId: "eq-laser",
    })
  );
  const created = (await response.json()).card;
  assert.equal(created.machine, null);
  assert.equal(created.machine_id, "eq-laser");
});

test("renaming equipment shows on its cards; deleting it unlinks them", async () => {
  await endpoint(equipmentItem, "PUT", { id: "eq-router" })(
    jsonRequest("/api/equipment/eq-router", "PUT", cookie, {
      name: "Shapeoko",
    })
  );
  assert.equal((await read("legacy-router")).linked_machine.name, "Shapeoko");
  const deleted = await endpoint(equipmentItem, "DELETE", { id: "eq-router" })(
    jsonRequest("/api/equipment/eq-router", "DELETE", cookie, {})
  );
  assert.equal(deleted.status, 200);
  const card = await read("legacy-router");
  assert.equal(card.machine_id, null);
  assert.equal(card.linked_machine, null);
  assert.equal(card.machine, null, "no stale text comes back as unlinked");
});
