import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const PORT = 32204;
const viewer = "slack:TTEAM:UMENTOR";
const sam = "slack:TTEAM:USAM";
// 1 pm in New York on Tuesday, Nov 17.
const now = new Date("2026-11-17T18:00:00.000Z");
const ago = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();

const printing = { id: "process-3d", name: "3D Printing" };
const cutting = { id: "process-cut", name: "Cutting" };

const equipment = [
  {
    id: "printer-1",
    name: "Printer 1",
    status: "available",
    maintenance_note: null,
    processes: [printing],
  },
  {
    id: "printer-2",
    name: "Printer 2",
    status: "available",
    maintenance_note: null,
    processes: [printing],
  },
  {
    id: "printer-3",
    name: "Printer 3",
    status: "maintenance",
    maintenance_note: "nozzle clog",
    processes: [printing],
  },
  {
    id: "saw",
    name: "Chop Saw",
    status: "available",
    maintenance_note: null,
    processes: [cutting],
  },
];

function card(
  id: string,
  title: string,
  column_id: string,
  minutesInColumn: number,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    title,
    column_id,
    assignee: null,
    created_by: "slack:TTEAM:UJORDAN",
    date_created: ago(minutesInColumn + 60),
    date_updated: ago(minutesInColumn),
    machine: null,
    machine_id: null,
    queue_position: null,
    due_date: null,
    processes: [printing],
    linked_machine: null,
    review_notes: [],
    ...extra,
  };
}

const cards = [
  // Waits for any 3D printer.
  card("waiting", "Socket Cap Head", "backlog", 300),
  // No machine and no process: in nobody's queue.
  card("loose", "Spacer", "backlog", 200, { processes: [] }),
  card("assigned", "Hex Shaft", "backlog", 100, { machine_id: "printer-2" }),
  card("running", "Button Head", "in-progress", 40, {
    machine_id: "printer-2",
    assignee: sam,
  }),
  card("stale-review", "Gearbox plate", "review", 2 * 24 * 60),
  card("fresh-review", "Belly pan", "review", 3 * 60),
  // 8 am today in New York.
  card("done-today", "Bumper", "done", 5 * 60),
  // 5 pm yesterday in New York.
  card("done-yesterday", "Intake roller", "done", 20 * 60),
];

test("the Shop tab shows counts, what needs attention and every machine", async () => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { ShopTab as ShopPage } from './src/components/phone/ShopTab';
    window.show = (viewerId) => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}>
          <ShopPage viewerId={viewerId} />
        </QueryClientProvider>);
    };
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/New_York",
    });
    page.setDefaultTimeout(3000);
    await page.clock.install({ time: now });
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/kanban/cards")
        return route.fulfill({ json: { cards } });
      if (url.pathname === "/api/equipment")
        return route.fulfill({ json: { equipment } });
      if (url.pathname === "/api/users")
        return route.fulfill({
          json: [{ onshape_user_id: sam, name: "Sam Park" }],
        });
      return route.fulfill({ json: {} });
    });
    await page.route(
      (url) =>
        url.host === `localhost:${PORT}` && !url.pathname.startsWith("/api/"),
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div>',
        })
    );
    await page.goto(`http://localhost:${PORT}/shop`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate((id) => (window as any).show(id), viewer);

    await page.getByRole("heading", { name: "Shop", level: 1 }).waitFor();

    // Counts per status.
    const counts = page.getByRole("list", { name: "Counts" });
    await counts.getByText("Backlog").waitFor();
    const count = (label: string) =>
      counts
        .getByRole("listitem")
        .filter({ hasText: label })
        .locator("[data-count]")
        .textContent();
    assert.equal(await count("Backlog"), "3");
    assert.equal(await count("In progress"), "1");
    assert.equal(await count("Review"), "2");
    assert.equal(await count("Done today"), "1");
    assert.equal(
      await counts.getByRole("link", { name: /Backlog/ }).getAttribute("href"),
      "/backlog"
    );

    // Needs attention: one entry per rule, each linking to where to act.
    const attention = page.getByRole("region", { name: "Needs attention" });
    const links = attention.getByRole("link");
    await links.first().waitFor();
    const entries = await Promise.all(
      (await links.all()).map(async (link) => [
        (await link.textContent())?.trim(),
        await link.getAttribute("href"),
      ])
    );
    assert.deepEqual(entries, [
      ["Printer 1 is idle with 1 part waiting", "/equipment/printer-1"],
      ["Gearbox plate waiting for review 2 d", "/parts/stale-review"],
      ["2 backlog parts have no machine", "/backlog"],
    ]);

    // Machines: status, who's running what for how long, and queue size.
    const machines = page.getByRole("list", { name: "Machines" });
    const row = (name: string) =>
      machines.getByRole("link").filter({ hasText: name });
    const machine = async (name: string) => ({
      status: (await row(name).locator("[data-status]").textContent())?.trim(),
      detail:
        (await row(name).locator("[data-detail]").count()) > 0
          ? (await row(name).locator("[data-detail]").textContent())?.trim()
          : null,
      queued: (await row(name).locator("[data-queued]").textContent())?.trim(),
      href: await row(name).getAttribute("href"),
    });
    assert.deepEqual(await machine("Printer 1"), {
      status: "Idle",
      detail: "1 part waiting",
      queued: "1",
      href: "/equipment/printer-1",
    });
    assert.deepEqual(await machine("Printer 2"), {
      status: "Running",
      detail: "Sam Park · Button Head · 40 min",
      queued: "2",
      href: "/equipment/printer-2",
    });
    assert.deepEqual(await machine("Printer 3"), {
      status: "Maintenance",
      detail: "nozzle clog",
      queued: "1",
      href: "/equipment/printer-3",
    });
    assert.deepEqual(await machine("Chop Saw"), {
      status: "Idle",
      detail: "Nothing queued",
      queued: "0",
      href: "/equipment/saw",
    });

    assert.equal(
      await page
        .getByRole("link", { name: "All equipment" })
        .getAttribute("href"),
      "/equipment"
    );
    // No mutations or refocus: the same open screen ages into attention and a new day.
    await page.clock.fastForward(22 * 60 * 60 * 1000);
    await attention
      .getByRole("link", { name: /Belly pan waiting for review/ })
      .waitFor();
    assert.equal(await count("Done today"), "0");
    assert.match((await machine("Printer 2")).detail ?? "", /22 h/);

    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    );
  } finally {
    await browser.close();
  }
});

test("the Shop tab says when the shop can't be loaded and tries again", async () => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { ShopTab } from './src/components/phone/ShopTab';
    window.show = (viewerId) => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}>
          <ShopTab viewerId={viewerId} />
        </QueryClientProvider>);
    };
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(3000);
    let failing = true;
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/kanban/cards")
        return failing
          ? route.fulfill({ status: 500, json: { error: "Database is busy" } })
          : route.fulfill({ json: { cards } });
      if (url.pathname === "/api/equipment")
        return route.fulfill({ json: { equipment } });
      if (url.pathname === "/api/users") return route.fulfill({ json: [] });
      return route.fulfill({ json: {} });
    });
    await page.route(
      (url) =>
        url.host === `localhost:${PORT}` && !url.pathname.startsWith("/api/"),
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div>',
        })
    );
    await page.goto(`http://localhost:${PORT}/shop`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate((id) => (window as any).show(id), viewer);

    await page.getByText("Database is busy").waitFor();
    assert.equal(await page.getByRole("list", { name: "Counts" }).count(), 0);
    failing = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("list", { name: "Counts" }).waitFor();
  } finally {
    await browser.close();
  }
});
