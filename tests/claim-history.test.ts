import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-claim-history-"));
process.env.APP_URL = "http://localhost";
process.env.SLACK_BOT_TOKEN = "xoxb-secret";
process.env.SLACK_WORKSPACE_ID = "TRHR";

// Slack answers as a healthy workspace; nothing here runs delivery, so status
// notifications stay pending where the status endpoint can show them.
globalThis.fetch = async (input, init) => {
  const method = String(input).split("/").at(-1);
  const body = Object.fromEntries(
    new URLSearchParams(String(init?.body ?? ""))
  );
  if (method === "auth.test")
    return Response.json({ ok: true, team_id: "TRHR", bot_id: "BBOT" });
  if (method === "users.info" || method === "users.lookupByEmail")
    return Response.json({
      ok: true,
      user: {
        id: body.user ?? "UALICE",
        team_id: "TRHR",
        deleted: false,
        is_bot: false,
        is_admin: true,
      },
    });
  if (method === "conversations.info")
    return Response.json({
      ok: true,
      channel: {
        id: "C123",
        name: "manufacturing",
        is_member: true,
        is_archived: false,
        is_channel: true,
      },
    });
  throw Error(`Unexpected Slack call ${method}`);
};

const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const { subscribeToKanbanEvents } = await import("../src/server/events/bus");
const cardList = await import("../src/pages/api/kanban/cards/index");
const cardDetail = await import("../src/pages/api/kanban/cards/[id]");
const claimRoute = await import("../src/pages/api/kanban/cards/[id]/claim");
const unclaimRoute = await import("../src/pages/api/kanban/cards/[id]/unclaim");
const slackStatus = await import("../src/pages/api/slack/status");
const slackConfig = await import("../src/pages/api/slack/config");
const alice = await signIn();
await signIn("bob@example.com", "bob");
const ALICE = "slack:TRHR:UALICE";
const BOB = "slack:TRHR:UBOB";

const saved = await endpoint(
  slackConfig,
  "PUT"
)(
  jsonRequest("/api/slack/config", "PUT", alice, {
    channel_id: "C123",
    enabled: true,
  })
);
assert.equal(saved.status, 200);

async function post(route: any, url: string, id: string, body: unknown) {
  const response = await endpoint(route, "POST", { id })(
    jsonRequest(url, "POST", alice, body)
  );
  assert.equal(response.status, 200, await response.clone().text());
}

async function read(id: string) {
  const response = await endpoint(cardDetail, "GET", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      headers: { Cookie: alice },
    })
  );
  return (await response.json()).card;
}

async function statusNotifications(id: string) {
  const response = await endpoint(
    slackStatus,
    "GET"
  )(
    new Request("http://localhost/api/slack/status", {
      headers: { Cookie: alice },
    })
  );
  assert.equal(response.status, 200);
  return (
    (await response.json()).pending as Array<{
      kind: string;
      card_id: string;
      old_status: string;
      new_status: string;
    }>
  )
    .filter((row) => row.card_id === id && row.kind === "status")
    .map((row) => `${row.old_status} → ${row.new_status}`);
}

test("claim and unclaim record status history, notify Slack and update open screens like a column move", async () => {
  const release = await endpoint(
    cardList,
    "POST"
  )(
    jsonRequest("/api/kanban/cards", "POST", alice, {
      id: "station-part",
      title: "Station part",
    })
  );
  assert.equal(release.status, 201);

  const events: unknown[] = [];
  const unsubscribe = subscribeToKanbanEvents((event) => events.push(event));
  try {
    // Alice, at a shared station, claims for Bob.
    await post(
      claimRoute,
      "/api/kanban/cards/station-part/claim",
      "station-part",
      { userId: BOB }
    );
    await post(
      unclaimRoute,
      "/api/kanban/cards/station-part/unclaim",
      "station-part",
      {}
    );
  } finally {
    unsubscribe();
  }

  const card = await read("station-part");
  const moves = card.status_history
    .slice(1)
    .map(
      (entry: any) =>
        `${entry.from_status} → ${entry.to_status} by ${entry.actor_id}`
    );
  assert.deepEqual(moves, [
    `Backlog → In Progress by ${ALICE}`,
    `In Progress → Backlog by ${ALICE}`,
  ]);
  assert.deepEqual(await statusNotifications("station-part"), [
    "Backlog → In Progress",
    "In Progress → Backlog",
  ]);
  assert.deepEqual(events, [
    { table: "kanban_cards", action: "update", id: "station-part" },
    { table: "kanban_cards", action: "update", id: "station-part" },
  ]);
  assert.equal(card.assignee, null);
});
