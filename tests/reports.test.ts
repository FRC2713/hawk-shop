import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-reports-"));
process.env.APP_URL = "http://localhost";
process.env.SLACK_BOT_TOKEN = "fixture";
process.env.SLACK_WORKSPACE_ID = "TRHR";
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const config = await import("../src/pages/api/slack/config");
const reports = await import("../src/pages/api/reports");
const { runSlackDelivery } = await import("../src/lib/slack/worker");

test("a member report reaches the report channel with safe diagnostics and a receipt", async () => {
  const original = fetch;
  const posts: Record<string, unknown>[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(input).split("/").at(-1);
    const body = JSON.parse(String(init?.body));
    if (method === "auth.test")
      return Response.json({ ok: true, team_id: "TRHR", bot_id: "B1" });
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
          id: body.channel,
          name: "reports",
          is_member: true,
          is_archived: false,
          is_channel: true,
        },
      });
    if (method === "chat.postMessage") {
      posts.push(body);
      return Response.json({ ok: true, channel: body.channel, ts: "123" });
    }
    throw Error("Unexpected network");
  };
  try {
    const cookie = await signIn();
    assert.equal(
      (
        await endpoint(
          config,
          "PUT"
        )(
          jsonRequest("/api/slack/config", "PUT", cookie, {
            channel_id: "CSTATUS",
            enabled: false,
            reports_enabled: true,
            reports_channel_id: "CREPORTS",
          })
        )
      ).status,
      200
    );
    const response = await endpoint(
      reports,
      "POST"
    )(
      jsonRequest("/api/reports", "POST", cookie, {
        message: "Broken <@UALL> & stuck",
        context: {
          page_path: "/kanban?token=secret",
          card_id: "card-1",
          error_id: "err-123",
          error_message: "Failed",
          user_agent: "Fixture",
          viewport: "800x600",
          headers: "secret-header",
          cookie: "secret-cookie",
        },
      })
    );
    assert.equal(response.status, 202);
    const receipt = await response.json();
    assert.match(receipt.report_id, /^[a-zA-Z0-9-]+$/);
    await runSlackDelivery();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].channel, "CREPORTS");
    const text = String(posts[0].text);
    for (const value of [
      "Alice",
      "http://localhost/kanban",
      "err-123",
      receipt.report_id,
      "Version:",
      "&lt;@UALL&gt; &amp;",
    ])
      assert.ok(text.includes(value), text);
    assert.doesNotMatch(text, /secret|fixture_suite|<@UALL>/);
    await runSlackDelivery();
    assert.equal(posts.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Slack rate limits defer a report and it still arrives after a day", async (t) => {
  let now = Date.now() + 5000;
  t.mock.method(Date, "now", () => now);
  const posts: Record<string, unknown>[] = [];
  let limited = true;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = String(input).split("/").at(-1);
      const body = JSON.parse(String(init?.body));
      if (method === "auth.test")
        return Response.json({ ok: true, team_id: "TRHR", bot_id: "B1" });
      if (method === "chat.postMessage") {
        if (limited)
          return new Response("", {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        posts.push(body);
        return Response.json({ ok: true, channel: body.channel, ts: "124" });
      }
      throw Error("Unexpected network");
    }
  );
  const cookie = await signIn("retry@example.com", "retry");
  assert.equal(
    (
      await endpoint(
        reports,
        "POST"
      )(
        jsonRequest("/api/reports", "POST", cookie, {
          message: "Retry this report",
        })
      )
    ).status,
    202
  );
  await runSlackDelivery({ now: () => now });
  limited = false;
  now += 59000;
  await runSlackDelivery({ now: () => now });
  assert.equal(posts.length, 0);
  now += 86400000;
  await runSlackDelivery({ now: () => now });
  assert.equal(posts.length, 1);
  assert.match(String(posts[0].text), /Retry this report/);
});

test("a member can submit five reports in ten minutes, including delivered reports", async () => {
  const cookie = await signIn();
  for (let i = 0; i < 4; i++)
    assert.equal(
      (
        await endpoint(
          reports,
          "POST"
        )(jsonRequest("/api/reports", "POST", cookie, { message: "Stuck" }))
      ).status,
      202
    );
  const result = await endpoint(
    reports,
    "POST"
  )(jsonRequest("/api/reports", "POST", cookie, { message: "Again" }));
  assert.equal(result.status, 429);
  assert.match((await result.json()).error, /wait/i);
});

test("reports reject unauthenticated, cross-origin, invalid, and disabled requests without posting", async (t) => {
  const cookie = await signIn("blocked@example.com", "blocked");
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("Must not send");
  });
  assert.equal(
    (
      await endpoint(
        reports,
        "POST"
      )(jsonRequest("/api/reports", "POST", "", { message: "No identity" }))
    ).status,
    401
  );
  const foreign = jsonRequest("/api/reports", "POST", cookie, {
    message: "Foreign",
  });
  foreign.headers.set("Origin", "https://attacker.example");
  assert.equal((await endpoint(reports, "POST")(foreign)).status, 403);
  for (const message of ["", "x".repeat(2001), 123])
    assert.equal(
      (
        await endpoint(
          reports,
          "POST"
        )(jsonRequest("/api/reports", "POST", cookie, { message }))
      ).status,
      400
    );
  const { saveSlackSettings } = await import("../src/lib/slack/settings");
  saveSlackSettings("CSTATUS", null, false, {
    reports_enabled: false,
    reports_channel_id: null,
  });
  assert.equal(
    (
      await endpoint(
        reports,
        "POST"
      )(jsonRequest("/api/reports", "POST", cookie, { message: "Disabled" }))
    ).status,
    404
  );
  await runSlackDelivery();
});
