import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-slack-delivery-"));
process.env.APP_URL = "http://localhost";
process.env.SLACK_BOT_TOKEN = "xoxb-fixture";
process.env.SLACK_WORKSPACE_ID = "TRHR";
const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
const cards = await import("../src/pages/api/kanban/cards/index");
const card = await import("../src/pages/api/kanban/cards/[id]");
const config = await import("../src/pages/api/slack/config");

type Post = {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: Array<Record<string, any>>;
  ts: string;
};
const posts: Post[] = [];
const calls: string[] = [];
let ts = 1000;
let now = Date.now();
let cookie = "";

function slackBody(init?: RequestInit) {
  return Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
}
// A stand-in for Slack's Web API. Read methods only see form fields, as on
// the real service, and every post gets its own timestamp.
function transport() {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "files.slack.com") {
      calls.push("upload-bytes");
      return new Response("OK");
    }
    assert.equal(url.origin, "https://slack.com", `unexpected host ${url}`);
    const method = url.pathname.split("/").at(-1)!;
    calls.push(method);
    const body = slackBody(init);
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
          name: "shop",
          is_member: true,
          is_archived: false,
          is_channel: true,
        },
      });
    if (method === "files.getUploadURLExternal")
      return Response.json({
        ok: true,
        upload_url: "https://files.slack.com/upload/v1/fixture",
        file_id: "FTHUMB",
      });
    if (method === "files.completeUploadExternal")
      return Response.json({ ok: true, files: [{ id: "FTHUMB" }] });
    if (method === "chat.postMessage") {
      const post: Post = {
        channel: body.channel,
        text: body.text,
        thread_ts: body.thread_ts,
        blocks: body.blocks ? JSON.parse(body.blocks) : undefined,
        ts: `${ts++}.000100`,
      };
      posts.push(post);
      return Response.json({ ok: true, channel: body.channel, ts: post.ts });
    }
    throw Error(`Unexpected transport ${method}`);
  };
}
async function save(enabled = true, channel_id = "C123") {
  const response = await endpoint(config, "PUT")(
    jsonRequest("/api/slack/config", "PUT", cookie, { enabled, channel_id }),
    {}
  );
  assert.equal(response.status, 200);
}
async function release(
  id: string,
  owner: string,
  title = "Bracket <@UFAKE>",
  extra: Record<string, unknown> = {}
) {
  const response = await endpoint(cards, "POST")(
    jsonRequest("/api/kanban/cards", "POST", owner, { id, title, ...extra }),
    {}
  );
  assert.equal(response.status, 201);
}
async function move(
  id: string,
  updates: Record<string, unknown>,
  actor = cookie
) {
  const response = await endpoint(card, "PATCH", { id })(
    jsonRequest(`/api/kanban/cards/${id}`, "PATCH", actor, updates),
    {}
  );
  assert.equal(response.status, 200);
}
async function remove(id: string) {
  const response = await endpoint(card, "DELETE", { id })(
    new Request(`http://localhost/api/kanban/cards/${id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    }),
    {}
  );
  assert.equal(response.status, 200);
}
async function atHour(hour: number, action: () => Promise<void>) {
  const originalNow = Date.now;
  now = originalNow() + hour * 3600000;
  Date.now = () => now;
  try {
    await action();
  } finally {
    Date.now = originalNow;
  }
}
// One worker pass. Slack posts are spaced a second apart, so each pass sends
// at most one message.
async function tick(seconds = 10) {
  now += seconds * 1000;
  const { runSlackDelivery } = await import("../src/lib/slack/worker");
  await runSlackDelivery({ now: () => now });
}
async function drain(passes = 8) {
  for (let i = 0; i < passes; i++) await tick();
}
// Every mrkdwn string in a message: the places Slack would parse mentions.
function mrkdwn(post: Post) {
  const found: string[] = [post.text];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (node.type === "mrkdwn" && typeof node.text === "string")
        found.push(node.text);
      Object.values(node).forEach(visit);
    }
  };
  visit(post.blocks);
  return found.join("\n");
}
const partMessages = (from: number) =>
  posts.slice(from).filter((post) => !post.thread_ts);
const replies = (from: number, parent: Post) =>
  posts.slice(from).filter((post) => post.thread_ts === parent.ts);

test("a release posts the part's own message, and every later move replies in its thread", async () =>
  atHour(1, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const start = posts.length;
    await release("first", owner, "Bracket <@UFAKE>", {
      machine: "Laser",
      dueDate: "2026-12-01",
    });
    await tick();
    assert.equal(posts.length, start + 1, "the release posts on its own");
    const parent = posts[start];
    assert.equal(parent.thread_ts, undefined);
    assert.equal(parent.text, "New part released: Bracket &lt;@UFAKE&gt;");
    assert.equal(parent.blocks?.[0].type, "header");
    assert.equal(parent.blocks?.[0].text.text, "Bracket <@UFAKE>");
    const details = mrkdwn(parent);
    assert.match(details, /Released by <@UALICE>/);
    assert.match(details, /\*Machine\*\nLaser/);
    assert.match(details, /\*Due date\*\n2026-12-01/);
    assert.match(details, /\*Quantity to make\*\nNot specified/);
    assert.match(details, /http:\/\/localhost\/kanban\?cardId=first/);
    assert.ok(!details.includes("<@UFAKE>"), "titles cannot mention anyone");

    await move("first", { column_id: "review" });
    await move("first", { column_id: "backlog" }, owner); // the submitter's own move
    await move("first", { title: "Renamed only" }); // no column change: silent
    await drain(3);
    const thread = replies(start, parent);
    assert.equal(thread.length, 2);
    assert.match(thread[0].text, /^<@UALICE>: .+ → .+ · moved by bob$/);
    assert.match(thread[1].text, /^<@UALICE>: .+ → .+ · moved by Alice$/);
    assert.equal(partMessages(start).length, 1);
  }));

test("Slack Retry-After is durable and shared with test posts across process restart", async () => {
  const { spawnSync } = await import("node:child_process");
  const { postSlackMessage } = await import("../src/lib/slack/messages");
  const originalNow = Date.now;
  now = originalNow() + 2 * 3600000;
  Date.now = () => now;
  try {
    globalThis.fetch = async () =>
      new Response("", { status: 429, headers: { "Retry-After": "7200" } });
    await assert.rejects(postSlackMessage("C123", "fixture"));
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "./tests/register-server-only.mjs",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import {postSlackMessage} from './src/lib/slack/messages.ts';
      globalThis.fetch=async()=>{throw Error('transport must stay quiet')};
      try { await postSlackMessage('C123','fixture');process.exit(2); }
      catch(error) { console.log(JSON.stringify({code:error.code,delay:error.retryAfterSeconds})); }
    `,
      ],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const resultBody = JSON.parse(result.stdout.trim());
    assert.equal(resultBody.code, "ratelimited");
    assert.ok(resultBody.delay >= 7200);
  } finally {
    Date.now = originalNow;
    transport();
  }
});

test("startup drains existing pending work without an incoming request", async () => {
  const { spawnSync } = await import("node:child_process");
  const originalNow = Date.now;
  now = originalNow() + 5 * 60 * 60 * 1000;
  Date.now = () => now;
  try {
    cookie = await signIn("bob@example.com", "bob");
    const owner = await signIn();
    transport();
    await save();
    await release("startup", owner, "Restart bracket");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "./tests/register-server-only.mjs",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      Date.now=()=>${now + 1000};
      globalThis.fetch=async(input,init)=>{
        const method=new URL(String(input)).pathname.split('/').at(-1);
        const body=Object.fromEntries(new URLSearchParams(String(init?.body??'')));
        if(method==='auth.test') return Response.json({ok:true,team_id:'TRHR',bot_id:'B1'});
        if(method==='users.info'||method==='users.lookupByEmail') return Response.json({ok:true,user:{id:body.user??'UALICE',team_id:'TRHR',deleted:false,is_bot:false}});
        if(method==='chat.postMessage') {console.log(body.text);return Response.json({ok:true,channel:body.channel,ts:'123.1'});}
        throw Error('unexpected');
      };
      const { startSlackWorker, stopSlackWorker }=await import('./src/lib/slack/worker.ts');
      startSlackWorker();
      setTimeout(()=>{stopSlackWorker()},100);
    `,
      ],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /New part released: Restart bracket/);
  } finally {
    Date.now = originalNow;
  }
});

test("long untrusted titles stay within Slack limits and cannot mention anyone", async () =>
  atHour(6, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const start = posts.length;
    await release("long", owner, "<!channel> <@UEVERYONE>" + "x".repeat(8000));
    await move("long", { column_id: "review" });
    await drain(2);
    const [parent] = partMessages(start);
    assert.ok(parent.blocks![0].text.text.length <= 150);
    assert.ok(parent.text.length < 4000);
    for (const post of posts.slice(start)) {
      assert.ok(!mrkdwn(post).includes("<@UEVERYONE>"));
      assert.ok(!mrkdwn(post).includes("<!channel>"));
    }
    assert.match(mrkdwn(parent), /cardId=long/);
  }));

test("every move and the deletion reply in order in the part's thread", async () =>
  atHour(7, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const columns = await import("../src/pages/api/kanban/config/index");
    const response = await endpoint(columns, "PUT")(
      jsonRequest("/api/kanban/config", "PUT", cookie, {
        columns: [
          { id: "backlog", title: "Queued", position: 0 },
          { id: "review", title: "Review", position: 1 },
          { id: "done", title: "Done", position: 2 },
        ],
      }),
      {}
    );
    assert.equal(response.status, 200);
    const start = posts.length;
    await release("order", owner, "Original plate");
    const actions = await import("../src/pages/api/mfg/parts/actions");
    const form = new FormData();
    form.set("action", "moveCard");
    form.set("cardId", "order");
    form.set("columnId", "review");
    const moved = await endpoint(actions, "POST")(
      new Request("http://localhost/api/mfg/parts/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
      }),
      {}
    );
    assert.equal(moved.status, 200);
    await move("order", { column_id: "backlog" });
    await move("order", { column_id: "done" });
    await remove("order");
    await drain(6);
    const [parent] = partMessages(start);
    assert.equal(partMessages(start).length, 1);
    assert.deepEqual(
      replies(start, parent).map((post) => post.text),
      [
        "<@UALICE>: Queued → Review · moved by bob",
        "<@UALICE>: Review → Queued · moved by bob",
        "<@UALICE>: Queued → Done · moved by bob",
        "<@UALICE>: Original plate was removed from the board by bob.",
      ]
    );
  }));

test("changes while notifications are off are dropped; a later move starts the part's message first", async () =>
  atHour(8, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save(false);
    await release("quiet", owner, "Quiet plate");
    await move("quiet", { column_id: "review" });
    await release("quiet-removed", owner);
    await remove("quiet-removed");
    const denied = await endpoint(card, "PATCH", { id: "quiet" })(
      jsonRequest("/api/kanban/cards/quiet", "PATCH", "", {
        column_id: "done",
      }),
      {}
    );
    assert.equal(denied.status, 401);
    await save(true);
    const start = posts.length;
    await drain(2);
    assert.equal(posts.length, start, "nothing is replayed after enabling");
    await move("quiet", { column_id: "done" });
    await drain(3);
    const [parent] = partMessages(start);
    assert.match(mrkdwn(parent), /Released by <@UALICE>/);
    assert.equal(replies(start, parent).length, 1);
    assert.equal(posts.length, start + 2);
  }));

test("outages back off, keep each part's order, and recover without delaying board updates", async () =>
  atHour(9, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const start = posts.length;
    globalThis.fetch = async () => {
      throw Error("secret transport failure");
    };
    await release("outage", owner, "Outage plate");
    await move("outage", { column_id: "review" });
    await move("outage", { column_id: "backlog" });
    await tick();
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      throw Error("still unavailable");
    };
    await tick(0);
    assert.equal(attempts, 0, "the failed event waits for its backoff");
    transport();
    await drain(4);
    const [parent] = partMessages(start);
    assert.equal(parent.text, "New part released: Outage plate");
    const thread = replies(start, parent);
    assert.equal(thread.length, 2);
    assert.ok(thread[0].ts < thread[1].ts);
  }));

test("Suite submitters are mentioned by Slack ID, legacy cards fall back to email, then to names", async () =>
  atHour(10, async () => {
    const owner = await signIn(null, "suite");
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const { db } = await import("../src/server/db/client");
    const { kanbanCards, users } = await import("../src/server/db/schema");
    // Legacy pre-Suite fixtures, arranged directly because new HTTP releases always bind a Suite owner.
    db.insert(users)
      .values({
        onshape_user_id: "onshape-123",
        name: "Legacy",
        email: "legacy@example.com",
      })
      .run();
    db.insert(kanbanCards)
      .values({
        id: "onshape-owned",
        title: "Onshape-era plate",
        column_id: "backlog",
        created_by: "onshape-123",
      })
      .run();
    db.insert(kanbanCards)
      .values({ id: "unknown", title: "Legacy plate", column_id: "backlog" })
      .run();
    const lookups: string[] = [];
    const controlled = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const method = new URL(String(input)).pathname.split("/").at(-1)!;
      const body = slackBody(init);
      if (method.startsWith("users."))
        lookups.push(`${method} ${body.user ?? body.email}`);
      return controlled(input, init);
    };
    const start = posts.length;
    await release("no-email", owner, "No email");
    await move("onshape-owned", { column_id: "done" });
    await move("unknown", { column_id: "review" });
    await drain(5);
    const texts = posts.slice(start).map((post) => mrkdwn(post));
    assert.ok(texts.some((text) => /Released by <@USUITE>/.test(text)));
    assert.ok(texts.some((text) => /^<@UALICE>: .+ → .+/m.test(text)));
    assert.ok(texts.some((text) => /^Unknown submitter: /m.test(text)));
    assert.ok(lookups.includes("users.info USUITE"));
    assert.ok(lookups.includes("users.lookupByEmail legacy@example.com"));
    globalThis.fetch = controlled;
    const unmatched = await signIn("absent@example.com", "absent");
    const before = posts.length;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("users.info")
        ? Response.json({ ok: false, error: "user_not_found" })
        : controlled(input, init);
    await release("unmatched", unmatched);
    await tick();
    assert.match(mrkdwn(posts[before]), /Released by absent/);
    transport();
  }));

test("a stored thumbnail is uploaded to Slack and shown on the part's message", async () =>
  atHour(11, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const { saveFile } = await import("../src/server/storage/files");
    const url = await saveFile(
      "thumbnails/fixture-part.png",
      Buffer.from("fixture image bytes")
    );
    assert.ok(url);
    const start = posts.length;
    calls.length = 0;
    await release("pictured", owner, "Pictured plate", { imageUrl: url });
    await tick();
    assert.equal(posts.length, start, "upload first, post on a later pass");
    assert.deepEqual(
      calls.filter(
        (call) => call.startsWith("files") || call === "upload-bytes"
      ),
      [
        "files.getUploadURLExternal",
        "upload-bytes",
        "files.completeUploadExternal",
      ]
    );
    await tick();
    const [parent] = partMessages(start);
    assert.deepEqual(parent.blocks![1].accessory.slack_file, { id: "FTHUMB" });
    await tick();
    assert.equal(
      calls.filter((call) => call === "files.getUploadURLExternal").length,
      1,
      "a retry never uploads twice"
    );
  }));

test("a thumbnail that is not stored yet is never fetched from Onshape for Slack", async () =>
  atHour(12, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const start = posts.length;
    calls.length = 0;
    await release("unpictured", owner, "Unpictured plate", {
      imageUrl:
        "/api/onshape/thumbnail?url=" +
        encodeURIComponent(
          "https://cad.onshape.com/api/thumbnails/abc/s/300x300"
        ),
    });
    await tick();
    const [parent] = partMessages(start);
    assert.equal(parent.blocks![1].accessory, undefined);
    assert.ok(!calls.some((call) => call.startsWith("files")));
  }));

test("a failed upload, such as a missing files:write scope, posts without the image", async () =>
  atHour(13, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const { saveFile } = await import("../src/server/storage/files");
    const url = await saveFile("thumbnails/scope.png", Buffer.from("bytes"));
    const controlled = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("files.getUploadURLExternal")
        ? Response.json({ ok: false, error: "missing_scope" })
        : controlled(input, init);
    const start = posts.length;
    await release("no-scope", owner, "No scope plate", { imageUrl: url });
    await tick();
    const [parent] = partMessages(start);
    assert.equal(parent.text, "New part released: No scope plate");
    assert.equal(parent.blocks![1].accessory, undefined);
    transport();
  }));

test("Slack rejecting the image block retries the message without it", async () =>
  atHour(14, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const { saveFile } = await import("../src/server/storage/files");
    const url = await saveFile("thumbnails/broken.png", Buffer.from("bytes"));
    const start = posts.length;
    await release("broken-image", owner, "Broken image", { imageUrl: url });
    await tick(); // upload
    const controlled = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("chat.postMessage") &&
      String(init?.body).includes("slack_file")
        ? Response.json({ ok: false, error: "invalid_blocks" })
        : controlled(input, init);
    await drain(3);
    const [parent] = partMessages(start);
    assert.equal(parent.blocks![1].accessory, undefined);
    transport();
  }));

test("a part message deleted in Slack is replaced on the next update", async () =>
  atHour(15, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const start = posts.length;
    await release("deleted-thread", owner, "Lost thread");
    await tick();
    const controlled = globalThis.fetch;
    let failed = false;
    globalThis.fetch = async (input, init) => {
      if (
        !failed &&
        String(input).endsWith("chat.postMessage") &&
        slackBody(init).thread_ts
      ) {
        failed = true;
        return Response.json({ ok: false, error: "thread_not_found" });
      }
      return controlled(input, init);
    };
    await move("deleted-thread", { column_id: "review" });
    await drain(4);
    const parents = partMessages(start);
    assert.equal(parents.length, 2);
    assert.equal(replies(start, parents[1]).length, 1);
    transport();
  }));

test("disable and channel changes cancel queued work; later updates start a new message in the new channel", async () =>
  atHour(16, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("cancel", owner);
    await tick();
    await move("cancel", { column_id: "review" });
    const original = globalThis.fetch;
    let releasePost!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("chat.postMessage")) {
        started();
        await new Promise<void>((resolve) => {
          releasePost = resolve;
        });
        throw Error("late failure");
      }
      return original(input, init);
    };
    const delivery = tick();
    await waiting;
    await save(false);
    await save(true, "C456");
    releasePost();
    await delivery;
    transport();
    const start = posts.length;
    await drain(2);
    assert.equal(posts.length, start, "canceled work is not revived");
    await move("cancel", { column_id: "done" });
    await drain(3);
    const [parent] = partMessages(start);
    assert.equal(parent.channel, "C456");
    assert.equal(replies(start, parent)[0].channel, "C456");
  }));

test("expired pending work is removed on restart even without deployment credentials", async () =>
  atHour(17, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("expires", owner);
    await move("expires", { column_id: "review" });
    const start = posts.length;
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "./tests/register-server-only.mjs",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    Date.now=()=>${now + 24 * 3600000 + 1};
    delete process.env.SLACK_BOT_TOKEN;
    globalThis.fetch=async()=>{throw Error('must not send')};
    const {runSlackDelivery}=await import('./src/lib/slack/worker.ts');await runSlackDelivery();
  `,
      ],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    await tick();
    assert.equal(posts.length, start);
  }));

test("column labels are captured at the move and never looked up at delivery", async () =>
  atHour(18, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const columns = await import("../src/pages/api/kanban/config/index");
    const custom = [
      { id: "backlog", title: "Queued & ready", position: 0 },
      { id: "laser", title: "Laser <@UFAKE>", position: 1 },
    ];
    let response = await endpoint(columns, "PUT")(
      jsonRequest("/api/kanban/config", "PUT", cookie, { columns: custom }),
      {}
    );
    assert.equal(response.status, 200);
    await release("custom", owner);
    await move("custom", { column_id: "laser" });
    response = await endpoint(columns, "PUT")(
      jsonRequest("/api/kanban/config", "PUT", cookie, {
        columns: custom.map((column) => ({ ...column, title: "Renamed" })),
      }),
      {}
    );
    assert.equal(response.status, 200);
    await drain(2);
    assert.match(
      posts.at(-1)!.text,
      /Queued &amp; ready → Laser &lt;@UFAKE&gt;/
    );
  }));

test("worker refuses unconfigured and mismatched workspaces and backs off configuration errors", async () =>
  atHour(19, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("workspace", owner);
    const start = posts.length;
    let attempts = 0;
    delete process.env.SLACK_WORKSPACE_ID;
    globalThis.fetch = async () => {
      attempts++;
      throw Error("must not reach Slack without pin");
    };
    await tick();
    assert.equal(attempts, 0);
    process.env.SLACK_WORKSPACE_ID = "TRHR";
    globalThis.fetch = async () => {
      attempts++;
      return Response.json({ ok: true, team_id: "TOTHER", bot_id: "B1" });
    };
    await tick(1);
    assert.equal(attempts, 0);
    await tick(15 * 60);
    assert.equal(attempts, 1);
    assert.equal(posts.length, start);
    transport();
    await tick(15 * 60);
    assert.equal(posts.length, start + 1);
  }));

test("a single pending record is never sent by concurrent worker calls", async () =>
  atHour(20, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("concurrent", owner);
    const start = posts.length;
    const { runSlackDelivery } = await import("../src/lib/slack/worker");
    now += 10000;
    await Promise.all([
      runSlackDelivery(),
      runSlackDelivery(),
      runSlackDelivery(),
    ]);
    assert.equal(posts.length, start + 1);
  }));

test("card changes and their Slack events either both commit or both roll back", async () =>
  atHour(21, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("atomic", owner);
    await drain(1);
    const { db } = await import("../src/server/db/client");
    // Fault injection at durable storage, never used to observe the outcome.
    db.$client.exec(
      "CREATE TRIGGER fixture_reject_pending BEFORE INSERT ON slack_pending BEGIN SELECT RAISE(ABORT,'fixture'); END"
    );
    try {
      const response = await endpoint(card, "PATCH", { id: "atomic" })(
        jsonRequest("/api/kanban/cards/atomic", "PATCH", cookie, {
          column_id: "review",
        }),
        {}
      );
      assert.equal(response.status, 500);
      const created = await endpoint(cards, "POST")(
        jsonRequest("/api/kanban/cards", "POST", owner, {
          id: "atomic-new",
          title: "Never created",
        }),
        {}
      );
      assert.equal(created.status, 500);
    } finally {
      db.$client.exec("DROP TRIGGER fixture_reject_pending");
    }
    const response = await endpoint(card, "GET", { id: "atomic" })(
      new Request("http://localhost/api/kanban/cards/atomic", {
        headers: { Cookie: cookie },
      }),
      {}
    );
    assert.equal((await response.json()).card.column_id, "backlog");
    const start = posts.length;
    await tick();
    assert.equal(posts.length, start);
  }));

test("card deep-link targets survive successful OAuth sign-in", async () => {
  await signIn("alice@example.com", "alice", "/kanban?cardId=part%2F42");
});

test("Retry-After beyond the delivery window expires the notification instead of posting early", async () =>
  atHour(22, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const start = posts.length;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("chat.postMessage")
        ? new Response("", { status: 429, headers: { "Retry-After": "90000" } })
        : original(input, init);
    await release("long-retry", owner);
    await tick();
    transport();
    await tick(23 * 3600);
    assert.equal(posts.length, start);
    await tick(3600 + 1);
    assert.equal(posts.length, start);
    await tick(2 * 3600);
    assert.equal(posts.length, start);
  }));

async function restartedDelivery(at: number) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/register-server-only.mjs",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    Date.now=()=>${at};
    const posts=[];
    globalThis.fetch=async(input,init)=>{
      const method=new URL(String(input)).pathname.split('/').at(-1);
      const body=Object.fromEntries(new URLSearchParams(String(init?.body??'')));
      if(method==='auth.test') return Response.json({ok:true,team_id:'TRHR',bot_id:'B1'});
      if(method==='users.info'||method==='users.lookupByEmail') return Response.json({ok:true,user:{id:body.user??'UALICE',team_id:'TRHR',deleted:false,is_bot:false}});
      if(method==='chat.postMessage') { posts.push(body); return Response.json({ok:true,channel:body.channel,ts:'${at}.1'}); }
      throw Error('unexpected');
    };
    const {runSlackDelivery}=await import('./src/lib/slack/worker.ts');
    await runSlackDelivery();
    console.log(JSON.stringify(posts));
  `,
    ],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim()) as Array<Record<string, string>>;
}

test("a restart between the part message and its reply keeps the thread", async () =>
  atHour(23, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("restart", owner, "Restart plate");
    await move("restart", { column_id: "review" });
    const first = await restartedDelivery(now + 1000);
    assert.equal(first.length, 1);
    assert.equal(first[0].thread_ts, undefined);
    const second = await restartedDelivery(now + 3000);
    assert.equal(second.length, 1);
    assert.equal(second[0].thread_ts, `${now + 1000}.1`);
    assert.deepEqual(await restartedDelivery(now + 5000), []);
  }));

test("formatting configuration errors back off the pending event", async () =>
  atHour(56, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    const original = globalThis.fetch;
    let checks = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("auth.test")) checks++;
      return original(input, init);
    };
    process.env.APP_URL = "invalid";
    try {
      await release("bad-url", owner);
      await tick();
      assert.equal(checks, 1);
      await tick(1);
      assert.equal(checks, 1, "configuration errors wait fifteen minutes");
    } finally {
      process.env.APP_URL = "http://localhost";
      transport();
      await save(false);
    }
  }));
