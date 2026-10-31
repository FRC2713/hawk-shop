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
const { Route: cards } = await import("../app/routes/api/kanban/cards.index");
const { Route: card } = await import("../app/routes/api/kanban/cards.$id");
const { Route: config } = await import("../app/routes/api/slack/config");
const posts: Array<Record<string, unknown>> = [];
let now = Date.now();
let cookie = "";
function transport() {
  globalThis.fetch = async (input, init) => {
    const method = new URL(String(input)).pathname.split("/").at(-1);
    const body = JSON.parse(String(init?.body));
    if (method === "auth.test")
      return Response.json({ ok: true, team_id: "TRHR", bot_id: "B1" });
    if (method === "users.lookupByEmail")
      return Response.json({
        ok: true,
        user: {
          id: "UALICE",
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
    if (method === "chat.postMessage") {
      posts.push(body);
      return Response.json({ ok: true, channel: body.channel, ts: "123.456" });
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
async function release(id: string, owner: string, title = "Bracket <@UFAKE>") {
  const response = await endpoint(cards, "POST")(
    jsonRequest("/api/kanban/cards", "POST", owner, {
      id,
      title,
      quantityToMake: 3,
      assignee: "bob",
    }),
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
test("a trusted other person moving a card delivers the transition snapshot without Slack in the request", async () => {
  const owner = await signIn();
  cookie = await signIn("bob@example.com", "bob");
  transport();
  await save();
  await release("first", owner);
  await move("first", {
    column_id: "in-progress",
    quantity_to_make: 3,
    actor: "alice",
  });
  assert.equal(posts.length, 0);
  now = Date.now() + 100;
  const { runSlackDelivery } = await import("../app/lib/slack/worker");
  await runSlackDelivery({ now: () => now });
  assert.equal(posts.length, 1);
  assert.match(String(posts[0].text), /<@UALICE>/);
  assert.match(String(posts[0].text), /Bracket &lt;@UFAKE&gt;/);
  assert.match(String(posts[0].text), /3/);
  assert.match(
    String(posts[0].text),
    /http:\/\/localhost\/kanban\?cardId=first/
  );
  assert.equal(posts[0].parse, "none");
  assert.equal(posts[0].unfurl_links, false);
  await runSlackDelivery({ now: () => now + 2000 });
  assert.equal(posts.length, 1);
});

test("Slack Retry-After is durable and shared with test posts across process restart", async () => {
  const { spawnSync } = await import("node:child_process");
  const { postSlackMessage } = await import("../app/lib/slack/messages");
  const originalNow = Date.now;
  now = originalNow() + 10000;
  Date.now = () => now;
  try {
    globalThis.fetch = async () =>
      new Response("", { status: 429, headers: { "Retry-After": "7200" } });
    await assert.rejects(postSlackMessage("C123", "fixture"));
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import {postSlackMessage} from './app/lib/slack/messages.ts';
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
  now = originalNow() + 3 * 60 * 60 * 1000;
  Date.now = () => now;
  try {
    cookie = await signIn("bob@example.com", "bob");
    const owner = await signIn();
    transport();
    await save();
    await release("startup", owner, "Restart bracket");
    await move("startup", { column_id: "review" });
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      Date.now=()=>${now + 100};
      globalThis.fetch=async(input,init)=>{
        const method=new URL(String(input)).pathname.split('/').at(-1);
        const body=JSON.parse(init.body);
        if(method==='auth.test') return Response.json({ok:true,team_id:'TRHR',bot_id:'B1'});
        if(method==='users.lookupByEmail') return Response.json({ok:true,user:{id:'UALICE',team_id:'TRHR',deleted:false,is_bot:false}});
        if(method==='chat.postMessage') {console.log(body.text);return Response.json({ok:true,channel:body.channel,ts:'123'});}
        throw Error('unexpected');
      };
      const { startSlackWorker, stopSlackWorker }=await import('./app/lib/slack/worker.ts');
      startSlackWorker();
      setTimeout(()=>{stopSlackWorker()},100);
    `,
      ],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Restart bracket/);
  } finally {
    Date.now = originalNow;
  }
});

test("untrusted long part and status text cannot truncate the card link or create Slack mentions", async () => {
  const originalNow = Date.now;
  now = originalNow() + 4 * 60 * 60 * 1000;
  Date.now = () => now;
  try {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("long", owner, "<@UEVERYONE>" + "x".repeat(8000));
    await move("long", { column_id: "review" });
    const { runSlackDelivery } = await import("../app/lib/slack/worker");
    await runSlackDelivery();
    const text = String(posts.at(-1)?.text);
    assert.ok(text.length < 4000, `message was ${text.length} characters`);
    assert.match(text, /cardId=long/);
    assert.ok(!text.includes("<@UEVERYONE>"));
  } finally {
    Date.now = originalNow;
  }
});

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
async function tick(seconds = 2) {
  now += seconds * 1000;
  const { runSlackDelivery } = await import("../app/lib/slack/worker");
  await runSlackDelivery({ now: () => now });
}
test("all entry points preserve backward/intermediate snapshots and deletion does not erase pending work", async () =>
  atHour(5, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("order", owner, "Original plate");
    const start = posts.length;
    const { Route: actions } =
      await import("../app/routes/api/mfg/parts.actions");
    const form = new FormData();
    form.set("action", "moveCard");
    form.set("cardId", "order");
    form.set("columnId", "review");
    form.set("actor", "alice");
    const response = await endpoint(actions, "POST")(
      new Request("http://localhost/api/mfg/parts/actions", {
        method: "POST",
        headers: { Cookie: cookie },
        body: form,
      }),
      {}
    );
    assert.equal(response.status, 200);
    await move("order", {
      column_id: "backlog",
      title: "Revised plate",
      quantity_to_make: 7,
    });
    await move("order", {
      column_id: "done",
      title: "Final plate",
      quantity_to_make: 9,
    });
    const removed = await endpoint(card, "DELETE", { id: "order" })(
      new Request("http://localhost/api/kanban/cards/order", {
        method: "DELETE",
        headers: { Cookie: cookie },
      }),
      {}
    );
    assert.equal(removed.status, 200);
    for (let i = 0; i < 4; i++) await tick();
    const sent = posts.slice(start).map((post) => String(post.text));
    assert.equal(sent.length, 3);
    assert.match(sent[0], /Backlog → Review\nOriginal plate/);
    assert.match(
      sent[1],
      /Review → Backlog\nRevised plate · Quantity to make: 7/
    );
    assert.match(sent[2], /Backlog → Done\nFinal plate · Quantity to make: 9/);
  }));
test("silent actions and pre-enable moves never produce notifications, even with forged actor data", async () =>
  atHour(6, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save(false);
    await release("silent", owner);
    await move("silent", { column_id: "review" });
    await save(true);
    await move("silent", { column_id: "done", actor: "bob" }, owner);
    await move("silent", {
      column_id: "done",
      title: "Edited without move",
      assignee: "someone",
    });
    const denied = await endpoint(card, "PATCH", { id: "silent" })(
      jsonRequest("/api/kanban/cards/silent", "PATCH", "", {
        column_id: "review",
      }),
      {}
    );
    assert.equal(denied.status, 401);
    await release("silent-release", owner);
    await endpoint(card, "DELETE", { id: "silent-release" })(
      new Request("http://localhost/api/kanban/cards/silent-release", {
        method: "DELETE",
        headers: { Cookie: cookie },
      }),
      {}
    );
    const start = posts.length;
    await tick();
    assert.equal(posts.length, start);
  }));
test("outages back off, preserve per-card order, and recover without delaying board updates", async () =>
  atHour(7, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("outage", owner, "Outage plate");
    const start = posts.length;
    globalThis.fetch = async () => {
      throw Error("secret transport failure");
    };
    await move("outage", { column_id: "review" });
    await move("outage", { column_id: "backlog" });
    await tick();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw Error("still unavailable");
    };
    await tick(0);
    assert.equal(calls, 0);
    transport();
    await tick(2);
    await tick(2);
    assert.equal(posts.length, start + 2);
    assert.match(String(posts[start].text), /Backlog → Review/);
    assert.match(String(posts[start + 1].text), /Review → Backlog/);
  }));
test("missing and unmatched email fall back to recorded names and legacy cards use Unknown submitter", async () =>
  atHour(8, async () => {
    const owner = await signIn(null, "legacy");
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("no-email", owner, "No email");
    const { db } = await import("../app/lib/db/client");
    const { kanbanCards } = await import("../app/lib/db/schema");
    // Legacy pre-OAuth fixture, arranged directly because new HTTP releases always bind an owner.
    db.insert(kanbanCards)
      .values({ id: "unknown", title: "Legacy plate", column_id: "backlog" })
      .run();
    await move("no-email", { column_id: "done" });
    await move("unknown", { column_id: "review" });
    const start = posts.length;
    await tick();
    await tick();
    assert.equal(posts.length, start + 2);
    assert.match(String(posts[start].text), /^legacy:/);
    assert.match(String(posts[start + 1].text), /^Unknown submitter:/);
    const unmatched = await signIn("absent@example.com", "absent");
    await release("unmatched", unmatched);
    await move("unmatched", { column_id: "done" });
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("users.lookupByEmail")
        ? Response.json({ ok: false, error: "users_not_found" })
        : original(input, init);
    await tick();
    assert.match(String(posts.at(-1)?.text), /^absent:/);
    transport();
  }));
test("disable and destination changes cancel retrying work; late failures cannot revive it", async () =>
  atHour(9, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("cancel", owner);
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
    await tick(10);
    assert.equal(posts.length, start);
    // New changes follow the new generation and channel.
    await move("cancel", { column_id: "done" });
    await tick();
    assert.equal(posts.at(-1)?.channel, "C456");
  }));
test("expired pending work is removed on restart even without deployment credentials", async () =>
  atHour(10, async () => {
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
        "tsx",
        "--input-type=module",
        "-e",
        `
    Date.now=()=>${now + 24 * 3600000 + 1};
    delete process.env.SLACK_BOT_TOKEN;
    globalThis.fetch=async()=>{throw Error('must not send')};
    const {runSlackDelivery}=await import('./app/lib/slack/worker.ts');await runSlackDelivery();
  `,
      ],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    await tick();
    assert.equal(posts.length, start);
  }));

test("custom column labels are captured at transition time and never looked up at delivery", async () =>
  atHour(11, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("custom", owner);
    const { Route: columns } =
      await import("../app/routes/api/kanban/config.index");
    const custom = [
      { id: "backlog", title: "Queued & ready", position: 0 },
      { id: "laser", title: "Laser <@UFAKE>", position: 1 },
    ];
    let response = await endpoint(columns, "PUT")(
      jsonRequest("/api/kanban/config", "PUT", cookie, { columns: custom }),
      {}
    );
    assert.equal(response.status, 200);
    await move("custom", { column_id: "laser" });
    response = await endpoint(columns, "PUT")(
      jsonRequest("/api/kanban/config", "PUT", cookie, {
        columns: custom.map((column) => ({ ...column, title: "Renamed" })),
      }),
      {}
    );
    assert.equal(response.status, 200);
    await tick();
    assert.match(
      String(posts.at(-1)?.text),
      /Queued &amp; ready → Laser &lt;@UFAKE&gt;/
    );
  }));
test("worker refuses unconfigured and mismatched workspaces and backs off configuration errors", async () =>
  atHour(12, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("workspace", owner);
    await move("workspace", { column_id: "review" });
    const start = posts.length;
    let calls = 0;
    delete process.env.SLACK_WORKSPACE_ID;
    globalThis.fetch = async () => {
      calls++;
      throw Error("must not reach Slack without pin");
    };
    await tick();
    assert.equal(calls, 0);
    process.env.SLACK_WORKSPACE_ID = "TRHR";
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ ok: true, team_id: "TOTHER", bot_id: "B1" });
    };
    await tick(1);
    assert.equal(calls, 0);
    await tick(15 * 60);
    assert.equal(calls, 1);
    assert.equal(posts.length, start);
    transport();
    await tick(15 * 60);
    assert.equal(posts.length, start + 1);
  }));
test("a single pending record is never sent by concurrent worker calls", async () =>
  atHour(13, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("concurrent", owner);
    await move("concurrent", { column_id: "done" });
    const start = posts.length;
    const { runSlackDelivery } = await import("../app/lib/slack/worker");
    await Promise.all([
      runSlackDelivery(),
      runSlackDelivery(),
      runSlackDelivery(),
    ]);
    assert.equal(posts.length, start + 1);
  }));
test("card update and capture either both commit or both roll back", async () =>
  atHour(14, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("atomic", owner);
    const { db } = await import("../app/lib/db/client");
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
  atHour(15, async () => {
    const owner = await signIn();
    cookie = await signIn("bob@example.com", "bob");
    transport();
    await save();
    await release("long-retry", owner);
    await move("long-retry", { column_id: "review" });
    const start = posts.length;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
      String(input).endsWith("chat.postMessage")
        ? new Response("", { status: 429, headers: { "Retry-After": "90000" } })
        : original(input, init);
    await tick();
    transport();
    await tick(23 * 3600);
    assert.equal(posts.length, start);
    await tick(3600 + 1);
    assert.equal(posts.length, start);
    await tick(2 * 3600);
    assert.equal(posts.length, start);
  }));
