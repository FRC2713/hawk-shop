import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";

const PORT = 32211;
const host = `http://localhost:${PORT}`;
const viewer = "slack:TTEAM:USAM";

const printing = { id: "process-3d-printing", name: "3D Printing" };
const milling = { id: "process-milling", name: "Milling" };
const machines = [
  {
    id: "printer-2",
    name: "Printer 2",
    status: "available",
    documentation_url: "https://docs.example/printer-sop",
    processes: [printing],
  },
  {
    id: "mill",
    name: "Tormach",
    status: "maintenance",
    documentation_url: null,
    processes: [milling],
  },
];

/** A card as `/api/kanban/cards` answers it; tests only read its fields. */
type Card = { id: string; [field: string]: any };

function card(fields: {
  id: string;
  title: string;
  [field: string]: unknown;
}): Card {
  return {
    column_id: "backlog",
    image_url: null,
    assignee: null,
    created_by: "slack:TTEAM:UJORDAN",
    date_created: "2026-11-12T15:00:00.000Z",
    date_updated: "2026-11-12T15:00:00.000Z",
    machine: null,
    machine_id: null,
    linked_machine: null,
    queue_position: null,
    due_date: null,
    content: null,
    release_issues: [],
    quantity_to_make: 1,
    onshape_material: "PLA",
    onshape_version_name: "v1",
    project: null,
    processes: [printing],
    review_notes: [],
    ...fields,
  };
}

const making = card({
  id: "socket",
  title: "Socket Cap Head",
  column_id: "in-progress",
  assignee: viewer,
  machine_id: "printer-2",
  linked_machine: { id: "printer-2", name: "Printer 2", status: "available" },
  quantity_to_make: 2,
  content: "4 walls, brim on.",
});
const assigned = card({
  id: "countersunk",
  title: "Counter Sunk Head",
  machine_id: "printer-2",
  linked_machine: { id: "printer-2", name: "Printer 2", status: "available" },
  quantity_to_make: 3,
  due_date: "2026-11-20",
});
const shared = card({
  id: "torx",
  title: "Torx drive 4x",
  quantity_to_make: 4,
  onshape_material: "PETG",
  due_date: "2026-11-16",
});

// 1 pm in New York on Tuesday, Nov 17.
const now = new Date("2026-11-17T18:00:00.000Z");

let browser: Browser;
let bundleText: string;

before(async () => {
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
    import { NextUpTab as NextUp } from './src/components/phone/NextUpTab';
    window.show = (viewerId) => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}>
          <NextUp viewerId={viewerId} />
        </QueryClientProvider>);
    };
  `,
    },
  });
  bundleText = bundle.outputFiles[0].text;
  browser = await chromium.launch();
});

after(() => browser?.close());

/**
 * A 390 px page with the API stubbed: `cards` is the shop's card list and the
 * Printer 2 queue is the Backlog cards on it or waiting for 3D printing.
 * Returns the page and the `METHOD path` calls it made.
 */
async function phone(cards: Card[]) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    timezoneId: "America/New_York",
  });
  page.setDefaultTimeout(3000);
  await page.clock.setFixedTime(now);
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}`);
    const claim = url.pathname.match(/^\/api\/kanban\/cards\/(.+)\/claim$/);
    const done = url.pathname.match(/^\/api\/kanban\/cards\/(.+)\/done$/);
    const unclaim = url.pathname.match(/^\/api\/kanban\/cards\/(.+)\/unclaim$/);
    if (unclaim) {
      const index = cards.findIndex((item) => item.id === unclaim[1]);
      cards[index] = { ...cards[index], column_id: "backlog", assignee: null };
      return route.fulfill({ json: { card: cards[index] } });
    }
    if (claim) {
      const index = cards.findIndex((item) => item.id === claim[1]);
      const body = request.postDataJSON();
      cards[index] = {
        ...cards[index],
        column_id: "in-progress",
        assignee: viewer,
        machine_id: body.machineId ?? cards[index].machine_id,
      };
      return route.fulfill({ json: { card: cards[index] } });
    }
    if (done) {
      const index = cards.findIndex((item) => item.id === done[1]);
      cards[index] = { ...cards[index], column_id: "review" };
      return route.fulfill({ json: { card: cards[index] } });
    }
    if (url.pathname === "/api/kanban/cards")
      return route.fulfill({ json: { cards } });
    if (url.pathname === "/api/equipment")
      return route.fulfill({ json: { equipment: machines } });
    if (url.pathname === "/api/equipment/printer-2/queue")
      return route.fulfill({
        json: {
          machine: machines[0],
          cards: cards.filter(
            (item) =>
              item.column_id === "backlog" &&
              (item.machine_id === "printer-2" || item.machine_id === null)
          ),
        },
      });
    if (url.pathname === "/api/equipment/mill/queue")
      return route.fulfill({ json: { machine: machines[1], cards: [] } });
    if (url.pathname === "/api/users")
      return route.fulfill({
        json: [
          { onshape_user_id: "slack:TTEAM:UJORDAN", name: "Jordan Lee" },
          { onshape_user_id: viewer, name: "Sam Park" },
        ],
      });
    return route.fulfill({ status: 404, json: { error: "Not stubbed" } });
  });
  await page.route(
    (url) =>
      url.host === `localhost:${PORT}` && !url.pathname.startsWith("/api/"),
    (route) =>
      route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
  );
  const open = async () => {
    await page.goto(host + "/next");
    await page.addScriptTag({ content: bundleText });
    await page.evaluate((viewer) => (window as any).show(viewer), viewer);
  };
  await open();
  return { page, requests, open };
}

/**
 * Each queue row's text pieces in order (Tailwind isn't loaded here, so the
 * pieces are joined with " | " instead of laid out).
 */
async function queueRows(page: Page) {
  return page
    .getByRole("list", { name: /^Waiting for/ })
    .getByRole("listitem")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const pieces: string[] = [];
        const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        while (walk.nextNode()) {
          const text = walk.currentNode.textContent?.trim();
          if (text) pieces.push(text);
        }
        return pieces.join(" | ");
      })
    );
}

test("without a machine, Next up asks for one and remembers the choice", async () => {
  const { page, open } = await phone([making, assigned, shared]);
  try {
    await page.getByRole("heading", { name: "Next up", level: 1 }).waitFor();
    const picker = page.getByRole("list", { name: "Machines" });
    await page.getByText("Which machine are you on?").waitFor();
    assert.equal(
      await page.getByRole("list", { name: /^Waiting for/ }).count(),
      0
    );
    await picker.getByRole("button", { name: /Tormach/ }).waitFor();
    await picker.getByText("Needs maintenance").waitFor();
    await picker.getByRole("button", { name: /Printer 2/ }).click();

    await page
      .getByRole("button", { name: "Machine: Printer 2. Change" })
      .waitFor();
    await page.getByRole("list", { name: "Waiting for Printer 2" }).waitFor();

    // A reload lands straight on the queue.
    await open();
    await page.getByRole("list", { name: "Waiting for Printer 2" }).waitFor();
    assert.equal(await page.getByText("Which machine are you on?").count(), 0);

    // The header changes the machine.
    await page
      .getByRole("button", { name: "Machine: Printer 2. Change" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Tormach/ })
      .click();
    await page
      .getByRole("button", { name: "Machine: Tormach. Change" })
      .waitFor();
    await page.getByText("Nothing waiting for Tormach").waitFor();
    await open();
    await page
      .getByRole("button", { name: "Machine: Tormach. Change" })
      .waitFor();

    // The choice is for today: the next morning asks again.
    await page.clock.setFixedTime(new Date("2026-11-18T13:00:00.000Z"));
    await open();
    await page.getByText("Which machine are you on?").waitFor();
  } finally {
    await page.close();
  }
});

async function onPrinter2(page: Page) {
  await page
    .getByRole("list", { name: "Machines" })
    .getByRole("button", { name: /Printer 2/ })
    .click();
  await page.getByRole("list", { name: "Waiting for Printer 2" }).waitFor();
}

test("queue rows show the facts and claim at this machine", async () => {
  const { page, requests } = await phone([assigned, shared]);
  try {
    await onPrinter2(page);
    await page.getByText("3D Printing · 2 waiting").waitFor();
    assert.equal(
      await page.getByRole("region", { name: "Working on" }).count(),
      0
    );
    assert.deepEqual(await queueRows(page), [
      "Counter Sunk Head | PLA · ×3 · due Fri | Claim",
      "Torx drive 4x | PETG · ×4 · overdue, due Nov 16 | any 3D Printing | Claim",
    ]);
    const overdue = page
      .getByRole("listitem")
      .filter({ hasText: "Torx drive 4x" })
      .locator("[data-overdue]");
    assert.equal(await overdue.count(), 1);
    assert.equal(
      await page
        .getByRole("link", { name: /Torx drive 4x/ })
        .getAttribute("href"),
      "/parts/torx"
    );

    await page.getByRole("button", { name: "Claim Torx drive 4x" }).click();
    const working = page.getByRole("region", { name: "Working on" });
    await working.getByRole("heading", { name: "Torx drive 4x" }).waitFor();
    assert.ok(requests.includes("POST /api/kanban/cards/torx/claim"));
    assert.deepEqual(await queueRows(page), [
      "Counter Sunk Head | PLA · ×3 · due Fri | Claim",
    ]);
  } finally {
    await page.close();
  }
});

test("the operator's part shows its facts, notes and SOP, and Done sends it to review", async () => {
  const { page, requests } = await phone([making, assigned]);
  try {
    await onPrinter2(page);
    const working = page.getByRole("region", { name: "Working on" });
    await working.getByRole("heading", { name: "Socket Cap Head" }).waitFor();
    await working.getByText("You're making on Printer 2").waitFor();
    assert.equal(
      await working.locator('[data-fact="Quantity"]').textContent(),
      "×2"
    );
    await working.getByText("PLA · v1").waitFor();
    await working.getByText("Note from Jordan Lee:").waitFor();
    await working.getByText("4 walls, brim on.").waitFor();
    assert.equal(
      await working
        .getByRole("link", { name: "Printer 2 SOP" })
        .getAttribute("href"),
      "https://docs.example/printer-sop"
    );
    assert.equal(
      await working
        .getByRole("link", { name: "Part details" })
        .getAttribute("href"),
      "/parts/socket"
    );

    const done = working.getByRole("button", { name: "Done, send to review" });
    await done.click();
    await working.waitFor({ state: "detached" });
    assert.ok(requests.includes("POST /api/kanban/cards/socket/done"));
    assert.ok(!requests.some((request) => request.endsWith("/claim")));
  } finally {
    await page.close();
  }
});

test("Unclaim beside Done puts the operator's part back in the queue", async () => {
  const { page, requests } = await phone([making, assigned]);
  try {
    await onPrinter2(page);
    const working = page.getByRole("region", { name: "Working on" });
    await working
      .getByRole("button", { name: "Done, send to review" })
      .waitFor();
    await working.getByRole("button", { name: "Unclaim" }).click();
    await working.waitFor({ state: "detached" });
    assert.ok(requests.includes("POST /api/kanban/cards/socket/unclaim"));
    assert.ok(!requests.some((request) => request.endsWith("/done")));
    await page
      .getByRole("list", { name: "Waiting for Printer 2" })
      .getByText("Socket Cap Head")
      .waitFor();
  } finally {
    await page.close();
  }
});
