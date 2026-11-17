import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-machine-queues-"));
process.env.APP_URL = "http://localhost";

const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cardList = await import("../src/pages/api/kanban/cards/index");
const cardDetail = await import("../src/pages/api/kanban/cards/[id]");
const equipmentList = await import("../src/pages/api/equipment/index");
const processQueue = await import("../src/pages/api/processes/[id]/queue");
const cookie = await signIn();

const PRINTING = "process-3d-printing";
const MILLING = "process-cnc-milling";

async function addMachine(name: string, processIds: string[]) {
  const response = await endpoint(
    equipmentList,
    "POST"
  )(jsonRequest("/api/equipment", "POST", cookie, { name, processIds }));
  assert.equal(response.status, 201);
  return (await response.json()).equipment as { id: string };
}

/** Releases a part at `releasedAt`, so release order is under the test's control. */
async function release(
  id: string,
  releasedAt: string,
  fields: { processIds?: string[]; machineId?: string; dueDate?: string } = {}
) {
  mock.timers.enable({ apis: ["Date"], now: new Date(releasedAt) });
  try {
    const response = await endpoint(
      cardList,
      "POST"
    )(
      jsonRequest("/api/kanban/cards", "POST", cookie, {
        id,
        title: id,
        ...fields,
      })
    );
    assert.equal(response.status, 201, await response.clone().text());
  } finally {
    mock.timers.reset();
  }
}

async function move(id: string, column_id: string) {
  const response = await endpoint(cardDetail, "PATCH", { id })(
    jsonRequest(`/api/kanban/cards/${id}`, "PATCH", cookie, { column_id })
  );
  assert.equal(response.status, 200);
}

async function get(route: Record<string, any>, url: string, id: string) {
  const response = await endpoint(route, "GET", { id })(
    new Request(`http://localhost${url}`, { headers: { Cookie: cookie } })
  );
  return { status: response.status, body: await response.json() };
}

async function readProcessQueue(id: string) {
  const { status, body } = await get(
    processQueue,
    `/api/processes/${id}/queue`,
    id
  );
  assert.equal(status, 200);
  return (body.cards as Array<{ id: string }>).map((card) => card.id);
}

test("a process queue lists Backlog parts with that process and no machine, oldest release first", async () => {
  const printer = await addMachine("Prusa MK4", [PRINTING]);
  await release("pq-new", "2026-03-03T00:00:00.000Z", {
    processIds: [PRINTING],
  });
  await release("pq-old", "2026-03-01T00:00:00.000Z", {
    processIds: [PRINTING, MILLING],
  });
  await release("pq-assigned", "2026-03-01T00:00:00.000Z", {
    processIds: [PRINTING],
    machineId: printer.id,
  });
  await release("pq-milled", "2026-03-01T00:00:00.000Z", {
    processIds: [MILLING],
  });
  await release("pq-started", "2026-03-01T00:00:00.000Z", {
    processIds: [PRINTING],
  });
  await move("pq-started", "in-progress");

  assert.deepEqual(await readProcessQueue(PRINTING), ["pq-old", "pq-new"]);
});

const machineQueue = await import("../src/pages/api/equipment/[id]/queue");

async function readMachineQueue(id: string) {
  const { status, body } = await get(
    machineQueue,
    `/api/equipment/${id}/queue`,
    id
  );
  assert.equal(status, 200);
  return (body.cards as Array<{ id: string }>).map((card) => card.id);
}

test("a machine's queue lists its own parts, then parts waiting for any machine of its processes", async () => {
  const mill = await addMachine("Tormach", [MILLING]);
  const other = await addMachine("Haas", [MILLING]);
  const sameDay = "2026-04-02T00:00:00.000Z";
  await release("mq-waiting-later", "2026-04-03T00:00:00.000Z", {
    processIds: [MILLING],
  });
  await release("mq-waiting-due-late", sameDay, {
    processIds: [MILLING],
    dueDate: "2026-05-20",
  });
  await release("mq-waiting-due-soon", sameDay, {
    processIds: [MILLING],
    dueDate: "2026-05-10",
  });
  await release("mq-mine-new", "2026-04-05T00:00:00.000Z", {
    processIds: [MILLING],
    machineId: mill.id,
  });
  await release("mq-mine-old", "2026-04-04T00:00:00.000Z", {
    machineId: mill.id,
  });
  await release("mq-theirs", "2026-04-01T00:00:00.000Z", {
    processIds: [MILLING],
    machineId: other.id,
  });
  await release("mq-printed", "2026-04-01T00:00:00.000Z", {
    processIds: [PRINTING],
  });
  await release("mq-mine-started", "2026-04-01T00:00:00.000Z", {
    machineId: mill.id,
  });
  await move("mq-mine-started", "in-progress");

  const queue = (await readMachineQueue(mill.id)).filter((id) =>
    id.startsWith("mq-")
  );
  assert.deepEqual(queue, [
    "mq-mine-old",
    "mq-mine-new",
    "mq-waiting-due-soon",
    "mq-waiting-due-late",
    "mq-waiting-later",
  ]);
  const missing = await get(
    machineQueue,
    "/api/equipment/eq-missing/queue",
    "eq-missing"
  );
  assert.equal(missing.status, 404);
});

const assignRoute =
  await import("../src/pages/api/kanban/cards/assign-machine");
const events = await import("../src/pages/api/kanban/events");

async function assign(cardIds: string[], machineId: string | null) {
  const response = await endpoint(
    assignRoute,
    "POST"
  )(
    jsonRequest("/api/kanban/cards/assign-machine", "POST", cookie, {
      cardIds,
      machineId,
    })
  );
  return { status: response.status, body: await response.json() };
}

async function read(id: string) {
  const { status, body } = await get(cardDetail, `/api/kanban/cards/${id}`, id);
  assert.equal(status, 200);
  return body.card;
}

/** Opens the live event stream and collects the ids of changed cards. */
async function watchLiveUpdates() {
  const abort = new AbortController();
  const response = await endpoint(
    events,
    "GET"
  )(
    new Request("http://localhost/api/kanban/events", {
      headers: { Cookie: cookie },
      signal: abort.signal,
    })
  );
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    async changedIds(expected: number) {
      const ids: string[] = [];
      while (ids.length < expected) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
        const frames = text.split("\n\n");
        text = frames.pop()!;
        for (const frame of frames) {
          const data = frame.match(/^event: change\ndata: (.*)$/m)?.[1];
          if (data) ids.push(JSON.parse(data).id);
        }
      }
      abort.abort();
      return ids;
    },
  };
}

test("a mentor assigns several process-queue parts to one machine at once, then back to the process queue", async () => {
  const printer = await addMachine("Bambu P1S", [PRINTING]);
  await release("as-a", "2026-05-01T00:00:00.000Z", { processIds: [PRINTING] });
  await release("as-b", "2026-05-02T00:00:00.000Z", { processIds: [PRINTING] });
  const historyBefore = (await read("as-a")).status_history.length;

  const live = await watchLiveUpdates();
  const assigned = await assign(["as-a", "as-b"], printer.id);
  assert.equal(assigned.status, 200);
  assert.deepEqual(
    assigned.body.cards.map((card: any) => [card.id, card.machine_id]),
    [
      ["as-a", printer.id],
      ["as-b", printer.id],
    ]
  );
  assert.deepEqual((await live.changedIds(2)).sort(), ["as-a", "as-b"]);
  assert.equal((await read("as-b")).linked_machine.name, "Bambu P1S");
  assert.equal((await read("as-a")).column_id, "backlog");
  assert.equal(
    (await read("as-a")).status_history.length,
    historyBefore,
    "assigning a machine is not a status change"
  );
  assert.deepEqual(
    (await readMachineQueue(printer.id)).filter((id) => id.startsWith("as-")),
    ["as-a", "as-b"]
  );
  assert.ok(!(await readProcessQueue(PRINTING)).includes("as-a"));

  const cleared = await assign(["as-a"], null);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.cards[0].machine_id, null);
  assert.ok((await readProcessQueue(PRINTING)).includes("as-a"));
});

test("assignment needs at least one known card and a known machine", async () => {
  assert.equal((await assign([], null)).status, 400);
  assert.equal((await assign("as-a" as unknown as string[], null)).status, 400);
  assert.equal((await assign(["as-missing"], null)).status, 404);
  assert.equal((await assign(["as-a"], "eq-missing")).status, 400);
});

const maintenance = await import("../src/pages/api/equipment/[id]/maintenance");

test("a machine that needs maintenance can't take parts", async () => {
  const printer = await addMachine("Ender 3", [PRINTING]);
  await release("mt-a", "2026-06-01T00:00:00.000Z", { processIds: [PRINTING] });
  const flagged = await endpoint(maintenance, "POST", { id: printer.id })(
    jsonRequest(`/api/equipment/${printer.id}/maintenance`, "POST", cookie, {
      note: "Nozzle clogged",
    })
  );
  assert.equal(flagged.status, 200);

  const refused = await assign(["mt-a"], printer.id);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "machine_needs_maintenance");
  assert.match(refused.body.error, /Ender 3 needs maintenance/);
  assert.equal((await read("mt-a")).machine_id, null);
});

test("a machine can't take a part whose process it lacks, and a bulk assign changes nothing when any part is refused", async () => {
  const laser = await addMachine("Glowforge", ["process-material-processing"]);
  await release("lp-cut", "2026-06-02T00:00:00.000Z", {
    processIds: ["process-material-processing"],
  });
  await release("lp-print", "2026-06-02T00:00:00.000Z", {
    processIds: [PRINTING],
  });

  const refused = await assign(["lp-cut", "lp-print"], laser.id);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "machine_lacks_process");
  assert.deepEqual(refused.body.cardIds, ["lp-print"]);
  assert.match(refused.body.error, /Glowforge can't do/);
  assert.equal((await read("lp-cut")).machine_id, null);
  assert.equal((await read("lp-print")).machine_id, null);

  assert.equal((await assign(["lp-cut"], laser.id)).status, 200);
});
