import assert from "node:assert/strict";
import { createServer } from "node:net";
import { fork } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Run after npm run build with HAWK_SHOP_VERIFY_BUILT_SERVER=1 npm test.
// The controlled process has no incoming HTTP requests and cannot reach Slack.
test(
  "production server startup resumes pending delivery before any HTTP requests",
  { skip: process.env.HAWK_SHOP_VERIFY_BUILT_SERVER !== "1" },
  async () => {
    const nativeFetch = globalThis.fetch;
    const directory = mkdtempSync(path.join(tmpdir(), "hawk-slack-runtime-"));
    process.env.DATA_DIR = directory;
    process.env.APP_URL = "http://localhost";
    process.env.SLACK_BOT_TOKEN = "fixture-token";
    process.env.SLACK_WORKSPACE_ID = "TRHR";
    const { endpoint, signIn, jsonRequest } = await import("./http-fixture");
    const { Route: cards } =
      await import("../app/routes/api/kanban/cards.index");
    const { Route: card } = await import("../app/routes/api/kanban/cards.$id");
    const { Route: config } = await import("../app/routes/api/slack/config");
    const owner = await signIn();
    const actor = await signIn("bob@example.com", "bob");
    globalThis.fetch = async (input, init) => {
      const method = new URL(String(input)).pathname.split("/").at(-1);
      const body = JSON.parse(String(init?.body));
      if (method === "auth.test")
        return Response.json({ ok: true, team_id: "TRHR", bot_id: "B1" });
      if (method === "users.lookupByEmail")
        return Response.json({
          ok: true,
          user: {
            id: "UBOB",
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
      throw Error("Board must not post");
    };
    assert.equal(
      (
        await endpoint(config, "PUT")(
          jsonRequest("/api/slack/config", "PUT", actor, {
            channel_id: "C123",
            enabled: true,
          }),
          {}
        )
      ).status,
      200
    );
    assert.equal(
      (
        await endpoint(cards, "POST")(
          jsonRequest("/api/kanban/cards", "POST", owner, {
            id: "runtime",
            title: "Startup plate",
          }),
          {}
        )
      ).status,
      201
    );
    assert.equal(
      (
        await endpoint(card, "PATCH", { id: "runtime" })(
          jsonRequest("/api/kanban/cards/runtime", "PATCH", actor, {
            column_id: "review",
          }),
          {}
        )
      ).status,
      200
    );
    const preload = path.join(directory, "transport.mjs");
    writeFileSync(
      preload,
      `
    globalThis.fetch=async(input,init)=>{
      if(!String(input).startsWith('https://slack.com/api/'))throw Error('External network forbidden');
      const method=new URL(String(input)).pathname.split('/').at(-1),body=JSON.parse(init.body);
      if(method==='auth.test')return Response.json({ok:true,team_id:'TRHR',bot_id:'B1'});
      if(method==='users.lookupByEmail')return Response.json({ok:true,user:{id:'UALICE',team_id:'TRHR',deleted:false,is_bot:false}});
      if(method==='chat.postMessage'){process.send?.({text:body.text});return Response.json({ok:true,channel:body.channel,ts:'123'});}
      throw Error('Unexpected method');
    };
  `
    );
    const reservation = createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve)
    );
    const address = reservation.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const child = fork(path.resolve(".output/server/index.mjs"), [], {
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
      execArgv: ["--import", preload],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    try {
      const result = await new Promise<{ text: string }>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error(`No startup delivery: ${output}`)),
          10000
        );
        child.once("message", (message) => {
          clearTimeout(timeout);
          resolve(message as { text: string });
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          reject(Error(`Early exit ${code}: ${output}`));
        });
      });
      assert.match(result.text, /Startup plate/);
      assert.match(result.text, /cardId=runtime/);
      const origin = `http://127.0.0.1:${port}`;
      const response = await nativeFetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(5000),
      }).catch((error) => {
        throw Error(`HTTP failed: ${output}`, { cause: error });
      });
      assert.equal(response.status, 200, await response.text());
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          child.kill("SIGTERM");
        });
    }
  }
);
