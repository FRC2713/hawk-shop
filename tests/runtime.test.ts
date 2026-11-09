import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import Database from "better-sqlite3";
import { chromium, expect } from "@playwright/test";

const identity = {
  "x-token-subject": "slack:TTEAM:UMEMBER",
  "x-hawk-slack-team": "TTEAM",
  "x-hawk-slack-user": "UMEMBER",
  "x-token-user-roles": "suite/member authp/user",
  "x-token-user-name": "Shop Member",
};
let origin: string;
let data: string;
let server: ChildProcess;
let output = "";

before(async () => {
  data = await mkdtemp(join(tmpdir(), "hawk-shop-astro-test-"));
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  const transport = join(data, "slack-transport.mjs");
  await writeFile(
    transport,
    `
    import {appendFileSync} from "node:fs";
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://slack.com/api/auth.test")
        return Response.json({ok:true,team_id:"TTEAM",bot_id:"BFIXTURE"});
      if (url === "https://slack.com/api/chat.postMessage") {
        const body = JSON.parse(init.body);
        appendFileSync(process.env.DATA_DIR + "/slack-posts.jsonl", JSON.stringify(body) + "\\n");
        return Response.json({ok:true,channel:body.channel,ts:"123"});
      }
      throw Error("Unexpected external request");
    };
  `
  );
  server = spawn(
    process.execPath,
    ["--import", transport, "dist/server/entry.mjs"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        DATA_DIR: data,
        APP_URL: origin,
        HAWK_SUITE_TRUST_PROXY: "true",
        HAWK_SUITE_TEAM_ID: "TTEAM",
        HAWK_SUITE_ISSUER: "https://suite.example/",
        SLACK_BOT_TOKEN: "fixture",
        SLACK_WORKSPACE_ID: "TTEAM",
        ONSHAPE_ACCESS_KEY: "",
        ONSHAPE_SECRET_KEY: "",
        ONSHAPE_REMAINING_WARN_AT: "",
        ONSHAPE_WEBHOOK_SECRET: "runtime-webhook-secret",
        ONSHAPE_WEBHOOK_BASE_URL: "https://shop.example.org",
        DATABASE_PATH: "",
        UPLOADS_DIR: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  server.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr?.on("data", (chunk) => {
    output += chunk;
  });
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

async function call(path: string, options: RequestInit = {}) {
  return fetch(origin + path, {
    ...options,
    redirect: "manual",
    headers: { ...identity, Origin: origin, ...options.headers },
  });
}
async function json(path: string, method: string, body: unknown) {
  const response = await call(path, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${await response.clone().text()}`
  );
  return response.json();
}

test("health stays public; Onshape cookies never grant Shop or API access", async () => {
  assert.equal((await fetch(origin + "/health")).status, 200);
  const cookie = `onshape_access_token=fake; onshape_expires_at=${Date.now() + 600000}`;
  for (const path of [
    "/api/kanban/cards",
    "/api/equipment",
    "/api/users",
    "/api/kanban/events",
    "/api/onshape/usage",
    "/api/files/private.png",
  ]) {
    const response = await fetch(origin + path, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("content-type") || "", /json/);
  }
  const page = await fetch(origin + "/kanban?auth=success", {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.equal(page.status, 302);
  assert.match(page.headers.get("location") || "", /^\/signin\?redirect=/);
  const invalid = await call("/api/kanban/cards", {
    headers: { "x-hawk-slack-team": "TOTHER" },
  });
  assert.equal(invalid.status, 401);
});

test("only the exact Onshape webhook POST is reachable without Suite identity", async () => {
  const deliver = (path: string, method = "POST") =>
    fetch(origin + path, {
      method,
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body:
        method === "POST"
          ? JSON.stringify({
              event: "onshape.model.lifecycle.changed",
              documentId: "doc",
            })
          : undefined,
    });
  const accepted = await deliver(
    "/api/onshape/webhook?secret=runtime-webhook-secret"
  );
  assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), "");
  const rejected = await deliver("/api/onshape/webhook?secret=wrong");
  assert.equal(rejected.status, 404);
  assert.equal(await rejected.text(), "");
  for (const [path, method] of [
    ["/api/onshape/webhook?secret=runtime-webhook-secret", "GET"],
    ["/api/onshape/webhook/?secret=runtime-webhook-secret", "POST"],
    ["/api/onshape/webhook/extra?secret=runtime-webhook-secret", "POST"],
    ["/api/onshape/webhooks?secret=runtime-webhook-secret", "POST"],
    ["/api/onshape/webhookx?secret=runtime-webhook-secret", "POST"],
    ["/api/onshape/parts?secret=runtime-webhook-secret", "GET"],
    ["/api/kanban/cards?secret=runtime-webhook-secret", "POST"],
  ]) {
    const response = await deliver(path, method);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("Suite login preserves a safe destination and never redirects to an outside site", async () => {
  const login = await fetch(
    origin + "/signin?redirect=" + encodeURIComponent("/kanban/done")
  );
  assert.match(
    await login.text(),
    /redirect_url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fkanban%2Fdone/
  );
  const unsafe = await call("/signin?redirect=https://evil.example/");
  assert.equal(unsafe.headers.get("location"), "/");
  const embedded = await fetch(origin + "/onshape_connector?documentId=test", {
    headers: { "Sec-Fetch-Dest": "iframe" },
  });
  assert.match(await embedded.text(), /target="_top"/);
});

test("Astro serves useful overview content without JavaScript and registers Suite assignees", async () => {
  const response = await call("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Shop overview/);
  assert.match(html, /Parts in progress/);
  assert.match(html, /Shop Member/);
  assert.match(html, /2713-red.svg/);
  assert.ok(!html.includes("astro-island"));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const users = await (await call("/api/users")).json();
  assert.ok(
    users.some(
      (user: { onshape_user_id: string }) =>
        user.onshape_user_id === identity["x-token-subject"]
    )
  );
});

test("cross-origin JSON and multipart writes are rejected before mutation", async () => {
  const response = await call("/api/kanban/cards", {
    method: "POST",
    headers: {
      Origin: "https://other.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "Rejected" }),
  });
  assert.equal(response.status, 403);
  const form = new FormData();
  form.set("action", "moveCard");
  const multipart = await call("/api/mfg/parts/actions", {
    method: "POST",
    headers: { Origin: "https://other.example" },
    body: form,
  });
  assert.equal(multipart.status, 403);
});

test("card creation, assignment, updates, status, due dates, quantities and deletion work with Suite alone", async () => {
  const result = await json("/api/kanban/cards", "POST", {
    title: "Fixture bracket",
    processIds: ["process-cnc-milling"],
    createdBy: "forged-submitter",
  });
  const id = result.card.id;
  assert.equal(result.card.created_by, identity["x-token-subject"]);
  const assigned = await json(`/api/kanban/cards/${id}/assign`, "POST", {
    assignee: identity["x-token-subject"],
  });
  assert.equal(assigned.card.assignee, identity["x-token-subject"]);
  const updated = await json(`/api/kanban/cards/${id}`, "PATCH", {
    title: "Fixture bracket edited",
    created_by: "forged-submitter",
    due_date: "2027-01-10",
    processIds: ["process-3d-printing"],
  });
  assert.equal(updated.card.due_date, "2027-01-10");
  assert.equal(updated.card.created_by, identity["x-token-subject"]);
  assert.equal(updated.card.processes[0].id, "process-3d-printing");
  const form = new FormData();
  form.set("action", "moveCard");
  form.set("cardId", id);
  form.set("columnId", "done");
  assert.equal(
    (
      await (
        await call("/api/mfg/parts/actions", { method: "POST", body: form })
      ).json()
    ).success,
    true
  );
  assert.equal(
    (await (await call(`/api/kanban/cards/${id}`)).json()).card.column_id,
    "done"
  );
  const add = new FormData();
  for (const [key, value] of Object.entries({
    action: "addCard",
    partNumber: "FIXTURE-PART",
    quantityPerRobot: "2",
    quantityToMake: "6",
    processIds: "process-cnc-milling",
    dueDate: "2027-01-11",
  }))
    add.set(key, value);
  const releasedResponse = await call("/api/mfg/parts/actions", {
    method: "POST",
    body: add,
  });
  const released = await releasedResponse.json();
  assert.equal(released.success, true, JSON.stringify(released));
  const cards = (await (await call("/api/kanban/cards")).json()).cards;
  const part = cards.find(
    (card: { title: string }) => card.title === "FIXTURE-PART"
  );
  assert.equal(part.quantity_to_make, 6);
  assert.equal(part.quantity_per_robot, 2);
  assert.equal(part.created_by, identity["x-token-subject"]);
  assert.equal(
    (await call(`/api/kanban/cards/${id}`, { method: "DELETE" })).status,
    200
  );
});

test("equipment, processes, upload storage and image deletion survive the routing migration", async () => {
  const process = (
    await json("/api/processes", "POST", { name: "Fixture process" })
  ).process;
  await json(`/api/processes/${process.id}`, "PUT", {
    name: "Fixture process edited",
  });
  const equipment = (
    await json("/api/equipment", "POST", {
      name: "Fixture mill",
      status: "available",
      processIds: [process.id],
    })
  ).equipment;
  await json(`/api/equipment/${equipment.id}`, "PUT", {
    name: "Fixture mill edited",
    location: "Shop",
  });
  const form = new FormData();
  form.set(
    "file",
    new File(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=",
          "base64"
        ),
      ],
      "fixture.png",
      { type: "image/png" }
    )
  );
  const uploadedResponse = await call(`/api/equipment/${equipment.id}/image`, {
    method: "POST",
    body: form,
  });
  assert.equal(uploadedResponse.status, 201);
  const uploaded = await uploadedResponse.json();
  const image = await call(uploaded.imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  const item = (await (await call(`/api/equipment/${equipment.id}`)).json())
    .equipment;
  assert.equal(item.name, "Fixture mill edited");
  assert.equal(item.processes[0].name, "Fixture process edited");
  assert.equal(
    (
      await call(
        `/api/equipment/${equipment.id}/image?imageUrl=${encodeURIComponent(uploaded.imageUrl)}`,
        { method: "DELETE" }
      )
    ).status,
    200
  );
  assert.equal((await call(uploaded.imageUrl)).status, 404);
  assert.equal(
    (await call(`/api/equipment/${equipment.id}`, { method: "DELETE" })).status,
    200
  );
  assert.equal(
    (await call(`/api/processes/${process.id}`, { method: "DELETE" })).status,
    200
  );
});

test("column configuration and live board changes still work", async () => {
  const config = await (await call("/api/kanban/config")).json();
  const renamed = {
    columns: config.columns.map((column: { title: string }, index: number) => ({
      ...column,
      title: index === 0 ? "Ready to make" : column.title,
    })),
  };
  await json("/api/kanban/config", "PUT", renamed);
  assert.equal(
    (await (await call("/api/kanban/config/columns")).json())[0].title,
    "Ready to make"
  );
  const controller = new AbortController();
  const stream = await call("/api/kanban/events", {
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let initial = "";
  while (!initial.includes("event: ready"))
    initial += decoder.decode((await reader.read()).value);
  await json("/api/kanban/cards", "POST", { title: "Live update fixture" });
  const event = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("No live change event")), 3000).unref()
    ),
  ]);
  assert.match(decoder.decode(event.value), /event: change/);
  controller.abort();
  await reader.cancel().catch(() => {});
});

test("cached CAD remains private and a missing connection does not expire Suite", async () => {
  const database = new Database(join(data, "hawk-shop.db"));
  database
    .prepare(
      "INSERT INTO onshape_api_cache(cache_key, payload, created_at, expires_at) VALUES (?, ?, ?, NULL)"
    )
    .run(
      "version::fixture-doc::fixture-version",
      JSON.stringify({ name: "Fixture version" }),
      new Date().toISOString()
    );
  database.close();
  const cached = await call(
    "/api/onshape/version?documentId=fixture-doc&versionId=fixture-version"
  );
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).name, "Fixture version");
  assert.equal(
    (
      await fetch(
        origin +
          "/api/onshape/version?documentId=fixture-doc&versionId=fixture-version"
      )
    ).status,
    401
  );
  assert.equal(
    (await call("/api/onshape/version?documentId=uncached&versionId=missing"))
      .status,
    409
  );
  assert.equal((await call("/api/kanban/cards")).status, 200);
  // The OAuth connection flow is gone; CAD uses the server key pair only.
  assert.equal((await call("/auth/onshape")).status, 404);
  const status = await call("/onshape");
  assert.equal(status.status, 200);
  assert.match(await status.text(), /Onshape API access is not configured/);
  const logout = await call("/auth/logout");
  assert.equal(
    logout.headers.get("location"),
    "https://suite.example/auth/logout"
  );
});

test(
  "desktop and mobile workflows hydrate, navigate, and expose controls in both themes",
  { timeout: 60000 },
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ extraHTTPHeaders: identity });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const [width, scheme] of [
        [1280, "light"],
        [390, "dark"],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(origin + "/");
        await expect(
          page.getByRole("heading", { name: "Shop overview" })
        ).toBeVisible();
        await page.getByRole("link", { name: "Board", exact: true }).click();
        await expect(
          page.getByPlaceholder("Search by part number or name...")
        ).toBeVisible();
        await expect(
          page.getByText("Live update fixture", { exact: true })
        ).toBeVisible();
        await page
          .getByPlaceholder("Search by part number or name...")
          .fill("FIXTURE-PART");
        await expect(
          page.getByText("FIXTURE-PART", { exact: true })
        ).toBeVisible();
        await expect(
          page.getByText("Live update fixture", { exact: true })
        ).toHaveCount(0);
        await page.screenshot({
          path: `/tmp/hawk-shop-board-${width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("link", { name: "Equipment", exact: true })
          .click();
        await expect(
          page.getByPlaceholder("Search equipment...")
        ).toBeVisible();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          `Page overflow at ${width}px`
        );
        await page.goto(origin + "/kanban/done");
        await expect(
          page.getByRole("heading", { name: "Done Cards" })
        ).toBeVisible();
        await page.goto(
          origin +
            "/onshape_connector?documentId=fixture&instanceId=fixture&elementId=fixture"
        );
        await expect(
          page.getByText("Onshape API access is not configured")
        ).toBeVisible();
      }
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test(
  "/onshape shows Onshape's reported remaining count, warns below the threshold, and names a 402",
  { timeout: 30000 },
  async () => {
    const seed = (
      label: string,
      remaining: number,
      observedAt: string,
      status: number
    ) => {
      const database = new Database(join(data, "hawk-shop.db"));
      database
        .prepare(
          "INSERT OR REPLACE INTO onshape_api_remaining(label, remaining, observed_at, last_status) VALUES (?, ?, ?, ?)"
        )
        .run(label, remaining, observedAt, status);
      database.close();
    };
    seed("users", 3000, "2026-11-08T12:00:00.000Z", 200);
    seed("parts", 250, "2026-11-09T12:00:00.000Z", 200);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ extraHTTPHeaders: identity });
      const page = await context.newPage();
      await page.goto(origin + "/onshape");
      await expect(
        page.getByText("Onshape reports 250 calls remaining")
      ).toBeVisible();
      await expect(page.getByText(/not the yearly allocation/i)).toBeVisible();
      await expect(page.getByRole("alert")).toContainText("below 1,000");
      await expect(
        page.getByRole("heading", { name: "Onshape's reported count is low" })
      ).toBeVisible();
      await expect(
        page.getByText(/users: 3,000 \(observed Nov 8, 2026/)
      ).toBeVisible();
      await expect(page.getByText("Calls sent to Onshape")).toBeVisible();
      await expect(page.getByText(/allocation used up/i)).toHaveCount(0);

      seed("thumbnails", 0, "2026-11-09T13:00:00.000Z", 402);
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Onshape API allocation used up" })
      ).toBeVisible();
      await expect(
        page.getByText("Onshape API access is not configured")
      ).toBeVisible();
      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test("header report dialog preserves failed text and confirms an accepted report", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: identity });
  const page = await context.newPage();
  const database = new Database(join(data, "hawk-shop.db"));
  try {
    await page.goto(origin + "/?cardId=header-card-context");
    await page.getByLabel("Account: Shop Member").click();
    await expect(
      page.getByRole("button", { name: "Report a problem", exact: true })
    ).toHaveCount(0);
    database
      .prepare(
        "INSERT INTO slack_config (id, enabled, reports_enabled, reports_channel_id, generation, updated_at) VALUES ('default',0,1,'CREPORTS',0,?) ON CONFLICT(id) DO UPDATE SET reports_enabled=1,reports_channel_id='CREPORTS'"
      )
      .run(new Date().toISOString());
    await page.reload();
    await page.getByLabel("Account: Shop Member").click();
    await page
      .getByRole("button", { name: "Report a problem", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("What went wrong?").fill("The board is stuck");
    await page.route("**/api/reports", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Please try again." }),
      })
    );
    await page
      .getByRole("button", { name: "Send report", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Please try again.");
    await expect(page.getByLabel("What went wrong?")).toHaveValue(
      "The board is stuck"
    );
    await page.unroute("**/api/reports");
    await page
      .getByRole("button", { name: "Send report", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      /Report ID: [a-f0-9-]{36}/
    );
    await expect
      .poll(
        async () =>
          await readFile(join(data, "slack-posts.jsonl"), "utf8").catch(
            () => ""
          )
      )
      .toContain("The board is stuck");
    assert.ok(
      (await readFile(join(data, "slack-posts.jsonl"), "utf8")).includes(
        "header-card-context"
      )
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("hawk-shop:report", {
          detail: {
            context: {
              error_id: "error-fixture",
              error_message: "Move failed",
              card_id: "card-fixture",
            },
            message: "The move failed",
          },
        })
      )
    );
    await expect(page.getByLabel("What went wrong?")).toHaveValue(
      "The move failed"
    );
    await expect(page.getByLabel("What went wrong?")).toBeFocused();
    const box = await page.getByRole("dialog").boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    await page
      .getByRole("button", { name: "Send report", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      /Report ID: [a-f0-9-]{36}/
    );
    await expect
      .poll(
        async () =>
          await readFile(join(data, "slack-posts.jsonl"), "utf8").catch(
            () => ""
          )
      )
      .toContain("error-fixture");
  } finally {
    database
      .prepare("UPDATE slack_config SET reports_enabled=0 WHERE id='default'")
      .run();
    database.close();
    await browser.close();
  }
});

test(
  "card details display release and live status history in desktop light and mobile dark themes",
  { timeout: 60000 },
  async () => {
    await json("/api/kanban/config", "PUT", {
      columns: [
        { id: "backlog", title: "Backlog", position: 0 },
        { id: "in-progress", title: "In Progress", position: 1 },
        { id: "review", title: "Review", position: 2 },
        { id: "done", title: "Done", position: 3 },
      ],
    });
    await json("/api/kanban/cards", "POST", {
      id: "history-browser",
      title: "History fixture",
    });
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ extraHTTPHeaders: identity });
      const page = await context.newPage();
      for (const [width, scheme] of [
        [1280, "light"],
        [390, "dark"],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(origin + "/kanban?cardId=history-browser");
        const history = page.getByRole("region", { name: "Status history" });
        await expect(history).toBeVisible();
        await expect(
          history.getByText("Released into Backlog", { exact: true })
        ).toBeVisible();
        await expect(
          history.getByText("Shop Member", { exact: true }).first()
        ).toBeVisible();
        if (width === 1280) {
          await json("/api/kanban/cards/history-browser", "PATCH", {
            column_id: "in-progress",
          });
        }
        await expect(
          history.getByText("Backlog → In Progress", { exact: true })
        ).toBeVisible();
        await expect(history.locator("time")).toHaveCount(2);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        );
      }
      await context.close();
    } finally {
      await browser.close();
    }
  }
);

test("metrics render on the server for members and validate the date range", async () => {
  const response = await call("/metrics?start=2026-01-01&end=2026-01-31");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of [
    "Shop metrics",
    "Time in each status",
    "Weekly throughput",
    'name="start"',
    'value="2026-01-01"',
  ])
    assert.ok(html.includes(text), text);
  assert.equal((await call("/metrics?start=2026-02-30")).status, 400);
  assert.equal((await fetch(origin + "/api/metrics")).status, 401);
  const overview = await (await call("/")).text();
  assert.ok(overview.includes('href="/metrics"'));
});

test("error displays and workflow boundaries open reports with their error references", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: identity });
  const page = await context.newPage();
  const database = new Database(join(data, "hawk-shop.db"));
  try {
    database
      .prepare(
        "INSERT INTO slack_config (id, enabled, reports_enabled, reports_channel_id, generation, updated_at) VALUES ('default',0,1,'CREPORTS',0,?) ON CONFLICT(id) DO UPDATE SET reports_enabled=1,reports_channel_id='CREPORTS'"
      )
      .run(new Date().toISOString());
    await page.route("**/api/equipment", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Fixture equipment failure",
          errorId: "abcdef123456",
        }),
      })
    );
    await page.goto(origin + "/equipment");
    await expect(page.getByText("Error ID:")).toContainText("abcdef123456", {
      timeout: 15000,
    });
    await page
      .getByRole("button", { name: "Report this", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("What went wrong?").fill("The equipment page failed");
    await page
      .getByRole("button", { name: "Send report", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Report ID:");
    await expect
      .poll(
        async () =>
          await readFile(join(data, "slack-posts.jsonl"), "utf8").catch(
            () => ""
          )
      )
      .toContain("abcdef123456");
    const posts = await readFile(join(data, "slack-posts.jsonl"), "utf8");
    assert.ok(posts.includes("Fixture equipment failure"));
    await page.unroute("**/api/equipment");
    await json("/api/kanban/cards", "POST", {
      id: "report-selected-card",
      title: "Report selected card",
    });
    await page.goto(origin + "/kanban?cardId=report-selected-card");
    await page
      .getByRole("button", {
        name: "Report a problem with this card",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog").last()).toBeVisible();
    await page.getByLabel("What went wrong?").fill("This card is stuck");
    await page
      .getByRole("button", { name: "Send report", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Report ID:");
    await expect
      .poll(
        async () =>
          await readFile(join(data, "slack-posts.jsonl"), "utf8").catch(
            () => ""
          )
      )
      .toContain("report-selected-card");
    // An invalid equipment shape causes a render failure caught by the island boundary.
    await page.route("**/api/equipment", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ equipment: { invalid: true } }),
      })
    );
    await page.goto(origin + "/equipment");
    await expect(
      page.getByRole("heading", { name: "Unable to display this workflow" })
    ).toBeVisible();
    await expect(page.getByText("Error ID:")).toContainText("client-");
    await page
      .getByRole("button", { name: "Report this", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    database
      .prepare("UPDATE slack_config SET reports_enabled=0 WHERE id='default'")
      .run();
    database.close();
    await browser.close();
  }
});
