import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.APP_URL = "http://localhost";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-shop-slack-"));
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const config = await import("../src/pages/api/slack/config");
test("Slack configuration requires a verified session", async () => {
  const response = await endpoint(config, "GET")(
    new Request("http://localhost/api/slack/config"),
    {}
  );
  assert.equal(response.status, 401);
});

process.env.SLACK_BOT_TOKEN = "xoxb-test-secret";
process.env.SLACK_WORKSPACE_ID = "TRHR";
let role: Record<string, unknown> = { is_admin: true };
let failure: string | null = null;
let channelFields: Record<string, unknown> = {};
let authFields: Record<string, unknown> = {};
const upstream: Array<{ method: string; body: Record<string, unknown> }> = [];
function controlSlack() {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://slack.com");
    const method = url.pathname.split("/").at(-1)!;
    const body = JSON.parse(String(init?.body));
    upstream.push({ method, body });
    if (failure) return Response.json({ ok: false, error: failure });
    if (method === "auth.test")
      return Response.json({
        ok: true,
        team_id: "TRHR",
        bot_id: "B123",
        user_id: "UBOT",
        ...authFields,
      });
    if (method === "users.info" || method === "users.lookupByEmail")
      return Response.json({
        ok: true,
        user: {
          id: body.user ?? "UALICE",
          team_id: "TRHR",
          deleted: false,
          is_bot: false,
          ...role,
        },
      });
    if (method === "conversations.list")
      return Response.json(
        body.cursor
          ? {
              ok: true,
              channels: [
                {
                  id: "C123",
                  name: "manufacturing",
                  is_member: true,
                  is_archived: false,
                  is_channel: true,
                },
                {
                  id: "CNO",
                  name: "excluded",
                  is_member: false,
                  is_archived: false,
                  is_channel: true,
                },
              ],
              response_metadata: { next_cursor: "" },
            }
          : {
              ok: true,
              channels: [],
              response_metadata: { next_cursor: "next" },
            }
      );
    if (method === "chat.postMessage")
      return Response.json({ ok: true, channel: body.channel, ts: "123.456" });
    if (method === "conversations.info")
      return Response.json({
        ok: true,
        channel: {
          id: body.channel,
          name: "manufacturing",
          is_member: true,
          is_archived: false,
          is_channel: true,
          ...channelFields,
        },
      });
    throw new Error(`Unexpected Slack method ${method}`);
  };
}
async function read(cookie: string) {
  return endpoint(config, "GET")(
    new Request("http://localhost/api/slack/config", {
      headers: { Cookie: cookie },
    }),
    {}
  );
}
test("each configuration read checks current workspace admin authority using the verified Suite Slack ID", async () => {
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    upstream.length = 0;
    assert.equal((await read(cookie)).status, 200);
    assert.equal(
      upstream.find((x) => x.method === "users.info")?.body.user,
      "UALICE"
    );
    assert.ok(!upstream.some((x) => x.method === "users.lookupByEmail"));
    for (const denied of [
      { is_admin: false, is_owner: false, is_channel_manager: true },
      { is_admin: true, id: "UOTHER" },
      { is_admin: true, deleted: true },
      { is_admin: true, team_id: "TOTHER" },
      { is_admin: true, is_bot: true },
      {},
    ]) {
      role = denied;
      assert.equal(
        (await read(cookie + "; onshape_user_id=owner")).status,
        403
      );
    }
    role = { is_owner: true };
    assert.equal((await read(cookie)).status, 200);
    failure = "invalid_auth";
    const denied = await read(cookie);
    assert.equal(denied.status, 503);
    assert.doesNotMatch(await denied.text(), /xoxb-test-secret/);
  } finally {
    globalThis.fetch = original;
    role = { is_admin: true };
    failure = null;
  }
});

test("admin saves one validated channel and enabled state durably", async () => {
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    const before = await (await read(cookie)).json();
    assert.equal(before.enabled, false);
    const saved = await endpoint(config, "PUT")(
      jsonRequest("/api/slack/config", "PUT", cookie, {
        channel_id: "C123",
        enabled: true,
      }),
      {}
    );
    assert.equal(saved.status, 200);
    const after = await (await read(cookie)).json();
    assert.equal(after.channel_id, "C123");
    assert.equal(after.enabled, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("channel discovery follows empty pages and test messages only target the saved validated channel", async () => {
  const channels = await import("../src/pages/api/slack/channels");
  const sendTest = await import("../src/pages/api/slack/test");
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    const result = await endpoint(channels, "GET")(
      new Request("http://localhost/api/slack/channels", {
        headers: { Cookie: cookie },
      }),
      {}
    );
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      channels: [{ id: "C123", name: "manufacturing" }],
    });
    const sent = await endpoint(sendTest, "POST")(
      jsonRequest("/api/slack/test", "POST", cookie, {
        email: "owner@example.com",
        channel_id: "CATTACK",
      }),
      {}
    );
    assert.equal(sent.status, 200);
    const post = upstream.findLast((x) => x.method === "chat.postMessage")!;
    assert.equal(post.body.channel, "C123");
    assert.doesNotMatch(String(post.body.text), /<@|<!/);
    assert.equal(post.body.parse, "none");
    assert.equal(post.body.unfurl_links, false);
    role = { is_admin: false };
    assert.equal(
      (
        await endpoint(sendTest, "POST")(
          jsonRequest("/api/slack/test", "POST", cookie, {}),
          {}
        )
      ).status,
      403
    );
  } finally {
    globalThis.fetch = original;
    role = { is_admin: true };
  }
});

test("cross-site and simple-form requests cannot change settings, including with iframe cookies", async () => {
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    const cases: Record<string, string>[] = [
      {
        Origin: "https://attacker.example",
        "X-Hawk-Shop-Slack": "1",
        "Content-Type": "application/json",
      },
      { Origin: "http://localhost", "Content-Type": "application/json" },
      {
        Origin: "http://localhost",
        "X-Hawk-Shop-Slack": "1",
        "Content-Type": "text/plain",
      },
    ];
    for (const headers of cases) {
      const result = await endpoint(config, "PUT")(
        new Request("http://localhost/api/slack/config", {
          method: "PUT",
          headers: { Cookie: cookie, ...headers },
          body: JSON.stringify({ channel_id: null, enabled: false }),
        }),
        {}
      );
      assert.equal(result.status, 403);
    }
    assert.equal((await (await read(cookie)).json()).enabled, true);
  } finally {
    globalThis.fetch = original;
  }
});

test("configuration survives a new server process using the same data volume", async () => {
  const cookie = await signIn();
  const { spawnSync } = await import("node:child_process");
  const script = `
  import {endpoint} from './tests/http-fixture.ts';
  import * as Route from './src/pages/api/slack/config.ts';
  globalThis.fetch=async(input)=>Response.json(String(input).endsWith('auth.test')?{ok:true,team_id:'TRHR',bot_id:'B123'}:{ok:true,user:{id:'UALICE',team_id:'TRHR',deleted:false,is_bot:false,is_admin:true}});
  const response=await endpoint(Route,'GET')(new Request('http://localhost/api/slack/config',{headers:{Cookie:process.env.TEST_COOKIE}}),{});
  console.log(JSON.stringify({status:response.status,body:await response.json()}));
 `;
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/register-server-only.mjs",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, TEST_COOKIE: cookie },
      encoding: "utf8",
    }
  );
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim().split("\n").at(-1)!);
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, true);
  assert.equal(result.body.channel_id, "C123");
});

test("missing deployment token, unknown member, forged identity, and upstream outages fail closed without leaking secrets", async () => {
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    delete process.env.SLACK_BOT_TOKEN;
    assert.equal((await read(cookie)).status, 503);
    process.env.SLACK_BOT_TOKEN = "xoxb-test-secret";
    assert.equal(
      (await read("onshape_user_id=alice; onshape_email=owner@example.com"))
        .status,
      401
    );
    failure = "user_not_found";
    assert.equal((await read(cookie)).status, 403);
    failure = null;
    globalThis.fetch = async () => {
      throw new Error(
        "xoxb-test-secret Authorization: Bearer xoxb-test-secret"
      );
    };
    const result = await read(cookie);
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /xoxb-test-secret|Authorization/);
  } finally {
    globalThis.fetch = original;
    process.env.SLACK_BOT_TOKEN = "xoxb-test-secret";
    failure = null;
  }
  // Email is not part of admin authority; the Suite Slack ID is enough.
  const noEmail = await signIn(null);
  controlSlack();
  try {
    assert.equal((await read(noEmail)).status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

test("workspace identity and channel membership are revalidated before configuration writes and tests", async () => {
  const channels = await import("../src/pages/api/slack/channels");
  const sendTest = await import("../src/pages/api/slack/test");
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    authFields = { team_id: "TOTHER" };
    assert.equal((await read(cookie)).status, 503);
    authFields = { bot_id: null };
    assert.equal((await read(cookie)).status, 503);
    authFields = {};
    for (const fields of [
      { is_member: false },
      { is_archived: true },
      { is_im: true },
      { is_mpim: true },
      { context_team_id: "TOTHER" },
    ]) {
      channelFields = fields;
      const result = await endpoint(config, "PUT")(
        jsonRequest("/api/slack/config", "PUT", cookie, {
          channel_id: "C123",
          enabled: true,
        }),
        {}
      );
      assert.equal(result.status, 503);
      assert.equal(
        (
          await endpoint(sendTest, "POST")(
            jsonRequest("/api/slack/test", "POST", cookie, {}),
            {}
          )
        ).status,
        503
      );
    }
    channelFields = {};
    role = { is_admin: false, is_channel_manager: true };
    assert.equal(
      (
        await endpoint(channels, "GET")(
          new Request("http://localhost/api/slack/channels", {
            headers: { Cookie: cookie },
          }),
          {}
        )
      ).status,
      403
    );
    assert.equal(
      (
        await endpoint(config, "PUT")(
          jsonRequest("/api/slack/config", "PUT", cookie, {
            channel_id: "C123",
            enabled: false,
            email: "owner@example.com",
          }),
          {}
        )
      ).status,
      403
    );
  } finally {
    globalThis.fetch = original;
    role = { is_admin: true };
    channelFields = {};
    authFields = {};
  }
});

test("channel discovery stops with a safe error when Slack returns excessive pagination", async () => {
  const channels = await import("../src/pages/api/slack/channels");
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  const controlled = fetch;
  let page = 0;
  globalThis.fetch = async (input, init) =>
    String(input).endsWith("conversations.list")
      ? Response.json({
          ok: true,
          channels: [],
          response_metadata: { next_cursor: ++page < 101 ? String(page) : "" },
        })
      : controlled(input, init);
  try {
    const result = await endpoint(channels, "GET")(
      new Request("http://localhost/api/slack/channels", {
        headers: { Cookie: cookie },
      }),
      {}
    );
    assert.equal(result.status, 503);
  } finally {
    globalThis.fetch = original;
  }
});

test("only Slack administrators can manage report settings and channels", async () => {
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    const payload = {
      enabled: false,
      channel_id: "C123",
      reports_enabled: true,
      reports_channel_id: "CREPORTS",
    };
    const saved = await endpoint(
      config,
      "PUT"
    )(jsonRequest("/api/slack/config", "PUT", cookie, payload));
    assert.equal(saved.status, 200);
    const settings = await saved.json();
    assert.equal(settings.reports_enabled, true);
    assert.equal(settings.reports_channel_id, "CREPORTS");
    const readback = await (await read(cookie)).json();
    assert.equal(readback.reports_channel_id, "CREPORTS");
    role = { is_admin: false };
    const rejected = await endpoint(
      config,
      "PUT"
    )(
      jsonRequest("/api/slack/config", "PUT", cookie, {
        ...payload,
        reports_enabled: false,
      })
    );
    assert.equal(rejected.status, 403);
  } finally {
    globalThis.fetch = original;
    role = { is_admin: true };
  }
});

test("admin denials name the failed check without exposing credentials", async () => {
  const cookie = await signIn();
  const original = fetch;
  controlSlack();
  try {
    for (const [fields, code] of [
      [{ is_admin: false, is_owner: false }, "not_admin"],
      [{ is_admin: true, deleted: true }, "inactive_member"],
      [{ is_admin: true, team_id: "TOTHER" }, "member_other_workspace"],
      [{ is_admin: true, id: "UOTHER" }, "member_mismatch"],
    ] as const) {
      role = fields;
      const response = await read(cookie);
      assert.equal(response.status, 403);
      const body = await response.json();
      assert.equal(body.code, code);
      assert.match(body.error, /UALICE|UOTHER|TOTHER/);
      assert.doesNotMatch(JSON.stringify(body), /xoxb-test-secret/);
    }
    role = { is_admin: true };
    failure = "user_not_found";
    assert.equal((await (await read(cookie)).json()).code, "unknown_member");
  } finally {
    globalThis.fetch = original;
    role = { is_admin: true };
    failure = null;
  }
});
