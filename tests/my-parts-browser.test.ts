import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "@playwright/test";

const PORT = 32235;
const viewer = "slack:TTEAM:UJORDAN";
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

const printing = { id: "process-3d-printing", name: "3D Printing" };

function card(id: string, fields: Record<string, unknown>) {
  return {
    id,
    column_id: "backlog",
    title: id,
    image_url: null,
    assignee: null,
    created_by: viewer,
    date_created: hoursAgo(100),
    date_updated: hoursAgo(50),
    machine: null,
    machine_id: null,
    queue_position: null,
    due_date: null,
    content: null,
    release_issues: null,
    quantity_to_make: 1,
    project_id: "project-miscellaneous",
    processes: [printing],
    linked_machine: null,
    review_notes: [],
    ...fields,
  };
}

const printer2 = { id: "printer-2", name: "Printer 2", status: "available" };

const cards = [
  card("Intake roller axle", {
    release_issues: [
      {
        code: "material_missing",
        severity: "warning",
        message: "No material set in Onshape.",
      },
    ],
    date_updated: hoursAgo(1),
  }),
  card("Gearbox plate", {
    column_id: "in-progress",
    assignee: "slack:TTEAM:USAM",
    machine_id: "printer-2",
    linked_machine: printer2,
    date_updated: hoursAgo(30),
    review_notes: [
      {
        id: 1,
        text: "Layer lines on the face.",
        author_name: "Riley",
        created_at: hoursAgo(80),
      },
      {
        id: 2,
        text: "Hole pattern doesn't match v3.",
        author_name: "Riley",
        // Written with the send-back, a moment after the move.
        created_at: hoursAgo(29.99),
      },
    ],
  }),
  // Sent back, then unclaimed and claimed again: someone is remaking it.
  card("Remade bracket", {
    column_id: "in-progress",
    assignee: "slack:TTEAM:USAM",
    machine_id: "printer-2",
    linked_machine: printer2,
    date_updated: hoursAgo(5),
    review_notes: [
      {
        id: 4,
        text: "Wrong hole size.",
        author_name: "Riley",
        created_at: hoursAgo(20),
      },
    ],
  }),
  card("Button Head 4x Size", {
    column_id: "in-progress",
    assignee: "slack:TTEAM:USAM",
    machine_id: "printer-2",
    linked_machine: printer2,
  }),
  // Someone else's part, ahead of ours in Printer 2's queue.
  card("Their spacer", {
    created_by: "slack:TTEAM:UALEX",
    machine_id: "printer-2",
    linked_machine: printer2,
    date_created: hoursAgo(200),
  }),
  card("Hex drive x4", { machine_id: "printer-2", linked_machine: printer2 }),
  card("Torx drive 4x", {}),
  card("Phillips 4x", { column_id: "review", date_updated: hoursAgo(2) }),
  // Sent back once, fixed and approved since: nothing to do.
  card("Spacer ring", {
    column_id: "done",
    date_updated: hoursAgo(48),
    review_notes: [
      {
        id: 3,
        text: "Too thin.",
        author_name: "Riley",
        created_at: hoursAgo(90),
      },
    ],
  }),
  card("Old bumper bracket", {
    column_id: "done",
    date_updated: hoursAgo(24 * 10),
  }),
  card("Not mine", { created_by: "slack:TTEAM:UALEX" }),
];

/** Each row as "title | detail", one entry per list item. */
function rows(list: Locator) {
  return list.getByRole("listitem").evaluateAll((items) =>
    items.map((item) =>
      [...item.querySelectorAll("a > *")]
        .map((part) => part.textContent?.trim())
        .filter(Boolean)
        .join(" | ")
    )
  );
}

async function bundle() {
  const result = await build({
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
    import { MyPartsTab as MyParts } from './src/components/phone/MyPartsTab';
    window.show = (viewerId) => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}>
          <MyParts viewerId={viewerId} />
        </QueryClientProvider>);
    };
  `,
    },
  });
  return result.outputFiles[0].text;
}

async function open(page: Page, script: string, cardList: unknown[]) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/kanban/cards")
      return route.fulfill({ json: { cards: cardList } });
    if (url.pathname === "/api/kanban/config/columns")
      return route.fulfill({
        json: [
          { id: "waiting-for-stock", title: "Waiting for stock", position: 4 },
        ],
      });
    if (url.pathname === "/api/equipment")
      return route.fulfill({
        json: { equipment: [{ ...printer2, processes: [printing] }] },
      });
    if (url.pathname === "/api/users")
      return route.fulfill({
        json: [
          { onshape_user_id: "slack:TTEAM:USAM", name: "Sam Park" },
          { onshape_user_id: viewer, name: "Jordan Lee" },
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
  await page.goto(`http://localhost:${PORT}/my-parts`);
  await page.addScriptTag({ content: script });
  await page.evaluate((viewerId) => (window as any).show(viewerId), viewer);
}

test("My parts puts what needs the submitter first, then groups the rest by status", async () => {
  const script = await bundle();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(3000);
    await open(page, script, cards);

    await page.getByText("Released by you · 7 active").waitFor();

    const needsYou = page.getByRole("list", { name: "Needs you" });
    await page.getByRole("heading", { name: "Needs you · 2" }).waitFor();
    assert.deepEqual(await rows(needsYou), [
      "Gearbox plate | Sent back from review: Hole pattern doesn't match v3.",
      "Intake roller axle | Release warning: No material set in Onshape.",
    ]);
    assert.equal(
      await needsYou
        .getByRole("link", { name: /Gearbox plate/ })
        .getAttribute("href"),
      "/parts/Gearbox%20plate"
    );

    const group = async (name: string) => {
      await page
        .getByRole("heading", { name: new RegExp(`^${name} · \\d+$`) })
        .waitFor();
      return rows(page.getByRole("list", { name }));
    };
    assert.deepEqual(await group("Being made"), [
      "Remade bracket | Printer 2 · Sam Park",
      "Button Head 4x Size | Printer 2 · Sam Park",
    ]);
    assert.deepEqual(await group("Waiting"), [
      "Hex drive x4 | 2nd in line · Printer 2",
      "Torx drive 4x | Any machine · 3D Printing",
    ]);
    assert.deepEqual(await group("In review"), ["Phillips 4x | 2 h in review"]);
    await page.getByRole("heading", { name: "Being made · 2" }).waitFor();
    await page.getByRole("heading", { name: "Waiting · 2" }).waitFor();
    await page.getByRole("heading", { name: "In review · 1" }).waitFor();

    // Done this week stays folded until asked.
    const done = page.getByText("Done this week · 1");
    await done.waitFor();
    assert.equal(await page.getByText("Spacer ring").isVisible(), false);
    await done.click();
    assert.deepEqual(await group("Done this week"), ["Spacer ring | 2 d ago"]);

    for (const title of ["Old bumper bracket", "Not mine", "Their spacer"])
      assert.equal(await page.getByText(title).count(), 0, title);
    assert.equal(
      await page
        .getByRole("link", { name: /Hex drive x4/ })
        .getAttribute("href"),
      "/parts/Hex%20drive%20x4"
    );
  } finally {
    await browser.close();
  }
});

test("My parts says so when the submitter has released nothing", async () => {
  const script = await bundle();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(3000);
    await open(page, script, [card("Not mine", { created_by: "someone" })]);
    await page.getByText("You haven't released any parts yet.").waitFor();
    assert.equal(await page.getByRole("list").count(), 0);
  } finally {
    await browser.close();
  }
});

test("My parts includes releases in custom statuses", async () => {
  const script = await bundle();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await open(page, script, [
      card("Stock bracket", { column_id: "waiting-for-stock" }),
      card("Own spacer", {
        column_id: "in-progress",
        assignee: viewer,
        machine_id: "printer-2",
        linked_machine: printer2,
      }),
    ]);
    await page
      .getByRole("heading", { name: "Waiting for stock · 1" })
      .waitFor();
    await page.getByRole("link", { name: /Stock bracket/ }).waitFor();
    assert.match(await page.locator("main").innerText(), /2 active/);
    // With nothing sent back or warned, the subtitle says so outright.
    await page
      .getByText("Released by you · 2 active · nothing needs you")
      .waitFor();
    // The viewer making their own part reads as "You", not their name.
    assert.deepEqual(
      await rows(page.getByRole("list", { name: "Being made" })),
      ["Own spacer | Printer 2 · You"]
    );
  } finally {
    await browser.close();
  }
});
