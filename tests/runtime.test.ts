import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
  server = spawn(process.execPath, ["dist/server/entry.mjs"], {
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
      SLACK_BOT_TOKEN: "",
      SLACK_WORKSPACE_ID: "",
      ONSHAPE_ACCESS_KEY: "",
      ONSHAPE_SECRET_KEY: "",
      ONSHAPE_REMAINING_WARN_AT: "",
      ONSHAPE_WEBHOOK_SECRET: "runtime-webhook-secret",
      ONSHAPE_WEBHOOK_BASE_URL: "https://shop.example.org",
      DATABASE_PATH: "",
      UPLOADS_DIR: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

test(
  "board search restores q, filters with processes, counts matches and supports dragging",
  { timeout: 60000 },
  async () => {
    const first = (
      await json("/api/kanban/cards", "POST", {
        title: "2713-24-112 Search bracket 0.5in",
        processIds: ["process-cnc-milling"],
      })
    ).card;
    const second = (
      await json("/api/kanban/cards", "POST", {
        title: "2713-24-113 Search plate 1-1/2",
        processIds: ["process-3d-printing"],
      })
    ).card;
    await json(`/api/kanban/cards/${first.id}`, "PATCH", {
      machine: "Search router",
    });
    await json(`/api/kanban/cards/${first.id}/assign`, "POST", {
      assignee: identity["x-token-subject"],
    });
    const config = await (await call("/api/kanban/config")).json();
    const target = config.columns[1];
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        extraHTTPHeaders: identity,
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(origin + "/kanban?q=112&keep=yes#board");
      const search = page.getByPlaceholder("Search by part number or name...");
      await expect(search).toHaveValue("112");
      const bracket = page.getByRole("heading", {
        name: first.title,
        exact: true,
      });
      const plate = page.getByRole("heading", {
        name: second.title,
        exact: true,
      });
      await expect(bracket).toBeVisible();
      await expect(plate).toHaveCount(0);
      await search.fill("1/2 router shop milling");
      await expect(bracket).toBeVisible();
      await expect(page).toHaveURL(/q=1%2F2\+router\+shop\+milling/);
      assert.equal(new URL(page.url()).searchParams.get("keep"), "yes");
      assert.equal(new URL(page.url()).hash, "#board");
      await page.reload();
      await expect(search).toHaveValue("1/2 router shop milling");
      await expect(bracket).toBeVisible();
      await search.fill("search");
      await expect(plate).toBeVisible();
      await page.getByRole("button", { name: "Filter by Process" }).click();
      await page
        .getByRole("menuitemcheckbox", { name: "CNC Milling", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(plate).toHaveCount(0);
      await expect(bracket).toBeVisible();
      await page.getByRole("button", { name: "Sort by user" }).click();
      await expect(bracket).toBeVisible();
      await page.getByRole("button", { name: "Processes (1)" }).click();
      await page
        .getByRole("menuitem", { name: "Show all", exact: true })
        .click();
      await expect(plate).toBeVisible();
      await page.getByRole("button", { name: "Clear search" }).click();
      await expect(plate).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.has("q"), false);
      await search.blur();
      await page.keyboard.press("/");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await page.keyboard.type("/");
      await expect(search).toHaveValue("/");
      await search.fill("112");
      // Moving the found card still uses the real board drag/drop and mutation.
      const sourceColumn = page.getByRole("region", {
        name: config.columns[0].title,
        exact: true,
      });
      const targetColumn = page.getByRole("region", {
        name: target.title,
        exact: true,
      });
      await expect(sourceColumn.getByLabel("Matching cards")).toHaveText("1");
      await expect(targetColumn.getByLabel("Matching cards")).toHaveText("0");
      const handle = sourceColumn.getByRole("button", {
        name: "Drag to reorder",
        exact: true,
      });
      const from = await handle.boundingBox();
      const to = await targetColumn.boundingBox();
      assert.ok(from && to);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + 150, { steps: 12 });
      await page.mouse.up();
      await expect(
        targetColumn.getByRole("heading", { name: first.title, exact: true })
      ).toBeVisible();
      await expect(sourceColumn.getByLabel("Matching cards")).toHaveText("0");
      await expect(targetColumn.getByLabel("Matching cards")).toHaveText("1");
      await context.close();
    } finally {
      await browser.close();
      await call(`/api/kanban/cards/${first.id}`, { method: "DELETE" });
      await call(`/api/kanban/cards/${second.id}`, { method: "DELETE" });
    }
  }
);

test(
  "release warning badges, full details and Has warnings combine with board search and processes",
  { timeout: 60000 },
  async () => {
    const cards: { id: string; title: string }[] = [];
    for (const [title, process] of [
      ["Warning review bracket", "process-cnc-milling"],
      ["Warning review plate", "process-3d-printing"],
      ["Warning review clean", "process-cnc-milling"],
    ]) {
      cards.push(
        (
          await json("/api/kanban/cards", "POST", {
            id: `warning-review-${cards.length}`,
            title,
            processIds: [process],
          })
        ).card
      );
    }
    const warning = {
      code: "missing-description",
      severity: "warning",
      message: "This part has no description.",
      fix: "Add a description in Onshape so the shop knows what it is.",
    };
    // Seed historical release snapshots; persistence is covered at the action/read seam.
    const database = new Database(join(data, "hawk-shop.db"));
    try {
      for (const card of cards.slice(0, 2))
        database
          .prepare("UPDATE kanban_cards SET release_issues = ? WHERE id = ?")
          .run(JSON.stringify([warning]), card.id);
    } finally {
      database.close();
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ extraHTTPHeaders: identity });
      await page.goto(origin + "/kanban?q=warning+review");
      const heading = (index: number) =>
        page.getByRole("heading", { name: cards[index].title, exact: true });
      await expect(heading(0)).toBeVisible();
      await expect(heading(2)).toBeVisible();
      await expect(
        heading(0).locator("..").getByText("Warnings (1)", { exact: true })
      ).toBeVisible();
      await expect(
        heading(2)
          .locator("..")
          .getByText(/Warnings/)
      ).toHaveCount(0);
      await heading(0).click();
      const details = page.getByRole("dialog");
      await expect(
        details.getByRole("heading", { name: "Release warnings" })
      ).toBeVisible();
      await expect(
        details.getByText(warning.message, { exact: true })
      ).toBeVisible();
      await expect(
        details.getByText(warning.fix, { exact: true })
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Has warnings", exact: true })
        .click();
      await expect(heading(0)).toBeVisible();
      await expect(heading(1)).toBeVisible();
      await expect(heading(2)).toHaveCount(0);
      await page.getByRole("button", { name: "Filter by Process" }).click();
      await page
        .getByRole("menuitemcheckbox", { name: "CNC Milling", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(heading(0)).toBeVisible();
      await expect(heading(1)).toHaveCount(0);
      await page.getByRole("textbox", { name: "Search board" }).fill("plate");
      await expect(heading(0)).toHaveCount(0);
      await expect(heading(1)).toHaveCount(0);
      await page.getByRole("button", { name: "Processes (1)" }).click();
      await page
        .getByRole("menuitem", { name: "Show all", exact: true })
        .click();
      await expect(heading(1)).toBeVisible();
      await page
        .getByRole("textbox", { name: "Search board" })
        .fill("warning review");
      await page
        .getByRole("button", { name: "Has warnings", exact: true })
        .click();
      await expect(heading(2)).toBeVisible();
      await heading(2).click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("heading", { name: "Release warnings" })
      ).toHaveCount(0);
    } finally {
      await browser.close();
      for (const card of cards)
        await call(`/api/kanban/cards/${card.id}`, { method: "DELETE" });
    }
  }
);

test(
  "Done search restores q and finds finished cards with shared fields and shortcuts",
  { timeout: 30000 },
  async () => {
    const config = await (await call("/api/kanban/config")).json();
    const first = (
      await json("/api/kanban/cards", "POST", {
        id: "done-search-bracket",
        title: "2713-24-164 Finished bracket 0.5in",
        processIds: ["process-cnc-milling"],
      })
    ).card;
    const second = (
      await json("/api/kanban/cards", "POST", {
        id: "done-search-plate",
        title: "2713-24-165 Finished plate",
      })
    ).card;
    for (const card of [first, second]) {
      await json(`/api/kanban/cards/${card.id}`, "PATCH", {
        column_id: config.columns.at(-1).id,
        machine: "Finished router",
      });
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        extraHTTPHeaders: identity,
        viewport: { width: 390, height: 900 },
        colorScheme: "dark",
      });
      await page.goto(origin + "/kanban/done?q=24-164&keep=yes#finished");
      const search = page.getByRole("textbox", {
        name: "Search completed cards",
      });
      const bracket = page.getByRole("heading", {
        name: first.title,
        exact: true,
      });
      const plate = page.getByRole("heading", {
        name: second.title,
        exact: true,
      });
      await expect(search).toHaveValue("24-164");
      await expect(bracket).toBeVisible();
      await expect(plate).toHaveCount(0);
      await search.fill("1/2 router shop milling");
      await expect(bracket).toBeVisible();
      await expect(plate).toHaveCount(0);
      await expect(page).toHaveURL(/q=1%2F2\+router\+shop\+milling/);
      assert.equal(new URL(page.url()).searchParams.get("keep"), "yes");
      assert.equal(new URL(page.url()).hash, "#finished");
      await page.reload();
      await expect(search).toHaveValue("1/2 router shop milling");
      await expect(bracket).toBeVisible();
      await search.fill("no-such-finished-part");
      await expect(bracket).toHaveCount(0);
      await expect(page.getByText("No matching completed cards")).toBeVisible();
      await page.getByRole("button", { name: "Clear search" }).click();
      await expect(bracket).toBeVisible();
      await expect(plate).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.has("q"), false);
      await search.blur();
      await page.keyboard.press("/");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await page.keyboard.type("/");
      await expect(search).toHaveValue("/");
      await page.evaluate(() => {
        history.pushState(null, "", "?q=24-165");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(search).toHaveValue("24-165");
      await expect(plate).toBeVisible();
      await expect(bracket).toHaveCount(0);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
    } finally {
      await browser.close();
      for (const card of [first, second])
        await call(`/api/kanban/cards/${card.id}`, { method: "DELETE" });
    }
  }
);

test(
  "connector search shares dimension and part-number matching while retaining fuzzy and substring search",
  { timeout: 30000 },
  async () => {
    // A second local server enables the connector island. Browser fixtures answer
    // CAD requests, so these placeholder credentials never leave the machine.
    const socket = createServer();
    await new Promise<void>((resolve) =>
      socket.listen(0, "127.0.0.1", resolve)
    );
    const address = socket.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const connectorOrigin = `http://127.0.0.1:${port}`;
    const connectorServer = spawn(process.execPath, ["dist/server/entry.mjs"], {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        NODE_ENV: "production",
        DATA_DIR: data,
        DATABASE_PATH: "",
        APP_URL: connectorOrigin,
        HAWK_SUITE_TRUST_PROXY: "true",
        HAWK_SUITE_TEAM_ID: "TTEAM",
        HAWK_SUITE_ISSUER: "https://suite.example/",
        ONSHAPE_ACCESS_KEY: "local-browser-fixture",
        ONSHAPE_SECRET_KEY: "local-browser-fixture",
        ONSHAPE_WEBHOOK_SECRET: "",
        ONSHAPE_WEBHOOK_BASE_URL: "",
        SLACK_BOT_TOKEN: "",
        SLACK_WORKSPACE_ID: "",
      },
      stdio: "ignore",
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          ready = (await fetch(connectorOrigin + "/api/health")).ok;
        } catch {}
        if (ready) break;
        if (connectorServer.exitCode !== null)
          throw new Error("Connector fixture server exited");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(ready, "Connector fixture server started");
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ extraHTTPHeaders: identity });
      let bracketName = "Connector bracket 0.5";
      await page.route("**/api/onshape/**", async (route) => {
        assert.equal(
          new URL(route.request().url()).pathname,
          "/api/onshape/parts"
        );
        await route.fulfill({
          json: [
            { partId: "bracket", name: bracketName, partNumber: "2713-24-112" },
            {
              partId: "plate",
              name: "Connector plate",
              partNumber: "2713-24-113",
            },
            {
              partId: "spacer",
              name: "Connector spacer 1/2",
              partNumber: "2713-24-114",
            },
          ],
        });
      });
      await page.goto(
        connectorOrigin +
          "/onshape_connector?documentId=fixture&instanceId=fixture&elementId=fixture"
      );
      const search = page.getByPlaceholder("Search parts...");
      const bracket = page.getByText("Connector bracket 0.5", { exact: true });
      const plate = page.getByText("Connector plate", { exact: true });
      const spacer = page.getByText("Connector spacer 1/2", { exact: true });
      await expect(bracket).toBeVisible();
      const searchFor = async (query: string) => {
        await search.fill(query);
        await expect(
          page.getByText("Searching...", { exact: true })
        ).toHaveCount(0);
      };
      await searchFor("1/2 bracket");
      await expect(bracket).toBeVisible();
      await expect(plate).toHaveCount(0);
      await expect(spacer).toHaveCount(0);
      await searchFor("0.5 spacer");
      await expect(spacer).toBeVisible();
      await expect(bracket).toHaveCount(0);
      await searchFor("1/2");
      await expect(bracket).toBeVisible();
      await expect(spacer).toBeVisible();
      await searchFor("24-112");
      await expect(bracket).toBeVisible();
      // Exact siblings no longer suppress the connector's fuzzy number matches.
      await expect(spacer).toBeVisible();
      await searchFor("112");
      await expect(bracket).toBeVisible();
      await expect(plate).toBeVisible();
      for (const query of ["braket", "RACKET"]) {
        await searchFor(query);
        await expect(bracket).toBeVisible();
        await expect(plate).toHaveCount(0);
      }
      await search.fill("no-such-connector-part");
      await expect(bracket).toHaveCount(0);
      await search.fill("   ");
      await expect(bracket).toBeVisible();
      await expect(plate).toBeVisible();
      await page.getByRole("button", { name: "Clear search" }).click();
      await expect(search).toHaveValue("");
      await expect(spacer).toBeVisible();
      // The server can return edited metadata without changing any part ids.
      bracketName = "Renamed connector bracket 0.5";
      await page.getByRole("button", { name: "Refresh data" }).click();
      await expect(page.getByText(bracketName, { exact: true })).toBeVisible();
      await search.fill("renamed");
      await expect(page.getByText(bracketName, { exact: true })).toBeVisible();
      await expect(plate).toHaveCount(0);
    } finally {
      await browser?.close();
      if (connectorServer.exitCode === null) {
        const exited = new Promise((resolve) =>
          connectorServer.once("exit", resolve)
        );
        connectorServer.kill("SIGTERM");
        await exited;
      }
    }
  }
);
