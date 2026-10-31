import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-slack-status-"));
process.env.APP_URL = "http://localhost";
process.env.SLACK_BOT_TOKEN = "xoxb-secret";
process.env.SLACK_WORKSPACE_ID = "TRHR";
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const { Route: status } = await import("../app/routes/api/slack/status");
const { Route: config } = await import("../app/routes/api/slack/config");
let admin = true;
let roleFailure = false;
let channelError: string | null = null;
function transport() {
  globalThis.fetch = async (input, init) => {
    const method = String(input).split("/").at(-1);
    if (roleFailure) throw Error("xoxb-secret raw upstream body");
    if (method === "auth.test")
      return Response.json({ ok: true, team_id: "TRHR", bot_id: "BBOT" });
    if (method === "users.lookupByEmail")
      return Response.json({
        ok: true,
        user: {
          id: "UALICE",
          team_id: "TRHR",
          deleted: false,
          is_bot: false,
          is_admin: admin,
          is_channel_manager: true,
        },
      });
    if (method === "conversations.info")
      return Response.json(
        channelError
          ? { ok: false, error: channelError }
          : {
              ok: true,
              channel: {
                id: "C123",
                name: "manufacturing",
                is_member: true,
                is_archived: false,
                is_channel: true,
              },
            }
      );
    if (method === "chat.postMessage")
      return Response.json({ ok: true, channel: "C123", ts: "1.2" });
    throw Error(`Unexpected transport ${method} ${init?.body}`);
  };
}
async function read(cookie = "") {
  return endpoint(status, "GET")(
    new Request("http://localhost/api/slack/status", {
      headers: { Cookie: cookie },
    }),
    {}
  );
}
async function save(cookie: string, enabled: boolean) {
  const response = await endpoint(config, "PUT")(
    jsonRequest("/api/slack/config", "PUT", cookie, {
      channel_id: "C123",
      enabled,
    }),
    {}
  );
  assert.equal(response.status, 200);
}
test("current health is administrator-only and role uncertainty never exposes pending work", async () => {
  assert.equal((await read()).status, 401);
  const cookie = await signIn();
  transport();
  assert.equal((await read(cookie)).status, 200);
  admin = false;
  assert.equal((await read(cookie)).status, 403);
  admin = true;
  roleFailure = true;
  const denied = await read(cookie);
  assert.equal(denied.status, 503);
  assert.doesNotMatch(await denied.text(), /xoxb-secret|raw upstream|pending/);
  const { Route: board } = await import("../app/routes/api/kanban/cards.index");
  const boardResponse = await endpoint(board, "GET")(
    new Request("http://localhost/api/kanban/cards", {
      headers: { Cookie: cookie },
    }),
    {}
  );
  assert.equal(boardResponse.status, 200);
  roleFailure = false;
});
test("health distinguishes disabled, ready, and current channel configuration problems", async () => {
  const cookie = await signIn();
  transport();
  assert.equal((await (await read(cookie)).json()).health.state, "disabled");
  await save(cookie, true);
  assert.equal((await (await read(cookie)).json()).health.state, "ready");
  channelError = "channel_not_found";
  const problem = await (await read(cookie)).json();
  assert.equal(problem.health.state, "problem");
  assert.equal(problem.health.issue.code, "channel_not_found");
  assert.match(problem.health.issue.action, /Invite/);
  channelError = null;
  process.env.APP_URL = "not a URL";
  const invalidUrl = await (await read(cookie)).json();
  assert.equal(invalidUrl.health.issue.code, "app_url_invalid");
  process.env.APP_URL = "http://localhost";
  assert.equal((await (await read(cookie)).json()).health.state, "ready");
});
test("pending health shows retry guidance and expiry, then removes delivered, canceled, and expired work durably", async () => {
  const originalNow = Date.now;
  let clock = originalNow();
  Date.now = () => clock;
  const { Route: cards } = await import("../app/routes/api/kanban/cards.index");
  const { Route: card } = await import("../app/routes/api/kanban/cards.$id");
  const { runSlackDelivery } = await import("../app/lib/slack/worker");
  const owner = await signIn();
  let actor = await signIn("bob@example.com", "bob");
  transport();
  const create = async (id: string) => {
    assert.equal(
      (
        await endpoint(cards, "POST")(
          jsonRequest("/api/kanban/cards", "POST", owner, {
            id,
            title: "Wheel plate",
            quantityToMake: 2,
          }),
          {}
        )
      ).status,
      201
    );
    assert.equal(
      (
        await endpoint(card, "PATCH", { id })(
          jsonRequest(`/api/kanban/cards/${id}`, "PATCH", actor, {
            column_id: "in-progress",
          }),
          {}
        )
      ).status,
      200
    );
  };
  try {
    await save(actor, true);
    await create("health-first");
    let view = await (await read(actor)).json();
    assert.equal(view.health.state, "pending");
    assert.equal(view.pending_count, 1);
    assert.equal(view.pending[0].old_status, "Backlog");
    assert.equal(
      Date.parse(view.pending[0].expires_at) -
        Date.parse(view.pending[0].created_at),
      86400000
    );
    assert.doesNotMatch(
      JSON.stringify(view),
      /alice@example.com|bob@example.com|submitter_email|xoxb-secret/
    );
    const normal = fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("chat.postMessage")
        ? new Response("raw xoxb-secret", { status: 503 })
        : normal(input, init);
    clock += 11000;
    await runSlackDelivery();
    view = await (await read(actor)).json();
    assert.equal(view.health.state, "problem");
    assert.equal(view.pending[0].issue.code, "unavailable");
    assert.match(view.pending[0].issue.action, /automatically/);
    assert.ok(Date.parse(view.pending[0].next_attempt_at) > clock);
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("chat.postMessage")
        ? Response.json({ ok: false, error: "missing_scope" })
        : normal(input, init);
    clock += 11000;
    await runSlackDelivery();
    view = await (await read(actor)).json();
    assert.equal(view.pending[0].issue.code, "missing_scope");
    assert.match(view.pending[0].issue.action, /Reinstall/);
    assert.equal(Date.parse(view.pending[0].next_attempt_at) - clock, 900000);
    transport();
    clock += 900001;
    await runSlackDelivery();
    view = await (await read(actor)).json();
    assert.equal(view.pending_count, 0);
    assert.equal(view.health.state, "ready");
    await create("health-canceled");
    await save(actor, false);
    assert.equal((await (await read(actor)).json()).pending_count, 0);
    await save(actor, true);
    assert.equal((await (await read(actor)).json()).pending_count, 0);
    await create("health-expired");
    clock += 86400001;
    actor = await signIn("bob@example.com", "bob");
    transport();
    assert.equal((await (await read(actor)).json()).pending_count, 0);
    const { spawnSync } = await import("node:child_process");
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import {endpoint} from './tests/http-fixture.ts';
    import {Route} from './app/routes/api/slack/status.ts';
    globalThis.fetch=async(input)=>Response.json(String(input).endsWith('auth.test')?{ok:true,team_id:'TRHR',bot_id:'B1'}:String(input).endsWith('users.lookupByEmail')?{ok:true,user:{id:'UALICE',team_id:'TRHR',deleted:false,is_bot:false,is_owner:true}}:{ok:true,channel:{id:'C123',name:'manufacturing',is_member:true,is_archived:false,is_channel:true}});
    const response=await endpoint(Route,'GET')(new Request('http://localhost/api/slack/status',{headers:{Cookie:process.env.TEST_COOKIE}}),{});
    console.log(JSON.stringify({status:response.status,body:await response.json()}));
  `,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, TEST_COOKIE: actor },
        encoding: "utf8",
      }
    );
    assert.equal(child.status, 0, child.stderr);
    const restarted = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.pending_count, 0);
    assert.equal(restarted.body.health.state, "ready");
  } finally {
    Date.now = originalNow;
  }
});
