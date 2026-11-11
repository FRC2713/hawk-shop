import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEV_IDENTITY, devIdentity } from "../src/server/dev-identity";

test("dev sign-in needs the flag, proxy trust off and a loopback client", () => {
  const on = { HAWK_SHOP_DEV_SIGNIN: "true" };
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
    assert.deepEqual(devIdentity(on, address), DEV_IDENTITY, address);
  assert.equal(devIdentity({}, "127.0.0.1"), undefined);
  for (const value of ["1", "TRUE", "yes", ""])
    assert.equal(
      devIdentity({ HAWK_SHOP_DEV_SIGNIN: value }, "127.0.0.1"),
      undefined,
      value
    );
  assert.equal(
    devIdentity({ ...on, HAWK_SUITE_TRUST_PROXY: "true" }, "127.0.0.1"),
    undefined
  );
  for (const address of [undefined, "", "192.168.1.20", "10.0.0.5", "::2"])
    assert.equal(devIdentity(on, address), undefined, String(address));
});

test("the dev identity is a well-formed Suite member identity", () => {
  assert.equal(
    DEV_IDENTITY.subject,
    `slack:${DEV_IDENTITY.teamId}:${DEV_IDENTITY.userId}`
  );
  assert.match(DEV_IDENTITY.teamId, /^T[A-Z0-9]+$/);
  assert.match(DEV_IDENTITY.userId, /^[UW][A-Z0-9]+$/);
});

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : Promise.resolve([join(dir, entry.name)])
    )
  );
  return nested.flat();
}

test("the production build contains no dev sign-in code", async () => {
  const built = (await files("dist")).filter((file) =>
    /\.(m?js|html)$/.test(file)
  );
  assert.ok(built.includes(join("dist", "server", "entry.mjs")));
  for (const file of built) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /HAWK_SHOP_DEV_SIGNIN|LOCALDEV/, file);
  }
});

let origin: string;
let data: string;
let server: ChildProcess;
let output = "";

before(async () => {
  data = await mkdtemp(join(tmpdir(), "hawk-shop-dev-signin-"));
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["dist/server/entry.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: data,
      APP_URL: origin,
      HAWK_SHOP_DEV_SIGNIN: "true",
      HAWK_SUITE_TRUST_PROXY: "false",
      SLACK_BOT_TOKEN: "",
      DATABASE_PATH: "",
      UPLOADS_DIR: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => (output += chunk));
  server.stderr?.on("data", (chunk) => (output += chunk));
  for (let tries = 0; tries < 100; tries++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch {}
    if (server.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not start: ${output}`);
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
  if (data) await rm(data, { recursive: true, force: true });
});

test("a built server ignores HAWK_SHOP_DEV_SIGNIN from a loopback client", async () => {
  for (const path of ["/api/kanban/cards", "/api/equipment"]) {
    const response = await fetch(origin + path, { redirect: "manual" });
    assert.equal(response.status, 503, path);
  }
  const write = await fetch(origin + "/api/kanban/cards", {
    method: "POST",
    redirect: "manual",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "dev", title: "Dev" }),
  });
  assert.equal(write.status, 503);
  for (const path of ["/kanban", "/equipment"]) {
    const response = await fetch(origin + path, { redirect: "manual" });
    assert.equal(response.status, 302, path);
    assert.match(response.headers.get("location") || "", /^\/signin\?/);
  }
  const signin = await fetch(origin + "/signin", { redirect: "manual" });
  assert.equal(signin.status, 503);
});
