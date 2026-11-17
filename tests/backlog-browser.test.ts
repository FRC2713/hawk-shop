import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "@playwright/test";

const PORT = 32233;
const printing = { id: "process-3d-printing", name: "3D Printing" };
const routing = { id: "process-router", name: "CNC Router" };

function card(
  id: string,
  title: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    column_id: "backlog",
    title,
    image_url: null,
    assignee: null,
    created_by: "slack:TTEAM:UJORDAN",
    date_created: "2026-11-12T15:00:00.000Z",
    date_updated: "2026-11-12T15:00:00.000Z",
    machine: null,
    machine_id: null,
    queue_position: null,
    due_date: null,
    content: null,
    release_issues: [],
    quantity_to_make: 2,
    onshape_material: "PLA",
    project: { id: "misc", name: "Miscellaneous", archived_at: null },
    processes: [printing],
    linked_machine: null,
    review_notes: [],
    ...fields,
  };
}

const warning = [
  {
    code: "missing_description",
    severity: "warning",
    message: "No description.",
  },
];

const cards = [
  card("sunk", "Counter Sunk Head"),
  card("hex", "Hex drive x4"),
  card("grid", "Sorting Grid", { release_issues: warning }),
  card("plate", "Side Plate", {
    processes: [routing],
    onshape_material: "Aluminum",
  }),
  card("axle", "Axle Spacer", { processes: [] }),
  card("bushing", "Bushing", {
    machine_id: "printer-2",
    linked_machine: { id: "printer-2", name: "Printer 2", status: "available" },
    release_issues: warning,
  }),
  card("clip", "Belt Clip", {
    machine_id: "printer-2",
    linked_machine: { id: "printer-2", name: "Printer 2", status: "available" },
  }),
  card("gusset", "Gusset", {
    column_id: "in-progress",
    assignee: "slack:TTEAM:USAM",
    machine_id: "printer-2",
  }),
  card("done", "Old Bracket", { column_id: "done" }),
];

const equipment = [
  {
    id: "printer-1",
    name: "Printer 1",
    status: "available",
    processes: [printing],
  },
  {
    id: "printer-2",
    name: "Printer 2",
    status: "available",
    processes: [printing],
  },
  {
    id: "printer-3",
    name: "Printer 3",
    status: "maintenance",
    processes: [printing],
  },
  { id: "router-1", name: "Router", status: "available", processes: [routing] },
];

const users = [
  { onshape_user_id: "slack:TTEAM:USAM", name: "Sam Park" },
  { onshape_user_id: "slack:TTEAM:UJORDAN", name: "Jordan Lee" },
];

let browser: Browser;
let script: string;

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
    import { BacklogTab } from './src/components/phone/BacklogTab';
    window.show = () => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}><BacklogTab /></QueryClientProvider>);
    };
  `,
    },
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch();
});

after(() => browser?.close());

type Call = { method: string; path: string; body: unknown };

async function open(): Promise<{ page: Page; calls: Call[] }> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(3000);
  const calls: Call[] = [];
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push({
      method: request.method(),
      path,
      body: request.postData() ? JSON.parse(request.postData()!) : null,
    });
    if (path === "/api/kanban/cards") return route.fulfill({ json: { cards } });
    if (path === "/api/equipment")
      return route.fulfill({ json: { equipment } });
    if (path === "/api/users") return route.fulfill({ json: users });
    if (path === "/api/kanban/cards/assign-machine")
      return route.fulfill({ json: { cards: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route(
    (url) =>
      url.host === `localhost:${PORT}` && !url.pathname.startsWith("/api/"),
    (route) =>
      route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
  );
  await page.goto(`http://localhost:${PORT}/backlog`);
  await page.addScriptTag({ content: script });
  await page.evaluate(() => (window as any).show());
  await page.getByRole("heading", { name: "Backlog", level: 1 }).waitFor();
  return { page, calls };
}

/** Each process group's heading and the part titles under it. */
async function groups(page: Page) {
  await page.getByRole("list").first().waitFor();
  return page.getByRole("list").evaluateAll((lists) =>
    lists.map((list) => ({
      group: list.getAttribute("aria-label"),
      parts: [...list.querySelectorAll("li")].map(
        (item) => item.querySelector("a > span")?.textContent ?? ""
      ),
    }))
  );
}

test("backlog groups parts by process, showing parts with no machine first", async () => {
  const { page } = await open();
  const filters = page.getByRole("group", { name: "Show" });
  assert.equal(
    await filters.getByRole("button", { pressed: true }).textContent(),
    "No machine 5"
  );
  await page.getByText("7 parts · 5 with no machine").waitFor();
  assert.deepEqual(await groups(page), [
    {
      group: "3D Printing",
      parts: ["Counter Sunk Head", "Hex drive x4", "Sorting Grid"],
    },
    { group: "CNC Router", parts: ["Side Plate"] },
    { group: "No process", parts: ["Axle Spacer"] },
  ]);

  await filters.getByRole("button", { name: "Warnings 2" }).click();
  assert.deepEqual(await groups(page), [
    { group: "3D Printing", parts: ["Bushing", "Sorting Grid"] },
  ]);
  const bushing = page.getByRole("listitem").filter({ hasText: "Bushing" });
  await bushing.getByText("PLA · ×2 · Printer 2 · 1 warning").waitFor();

  await filters.getByRole("button", { name: "All 7" }).click();
  assert.deepEqual(
    (await groups(page)).map((g) => [g.group, g.parts.length]),
    [
      ["3D Printing", 5],
      ["CNC Router", 1],
      ["No process", 1],
    ]
  );
  await page.close();
});

/** Each choice in the open assign sheet: its text and whether it's disabled. */
async function choices(page: Page) {
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  return sheet.locator("[data-choice]").evaluateAll((buttons) =>
    buttons.map((button) => ({
      text: button.textContent,
      disabled: (button as HTMLButtonElement).disabled,
    }))
  );
}

test("selected parts are assigned from a sheet of the machines that can take them", async () => {
  const { page, calls } = await open();
  const row = (title: string) =>
    page.getByRole("listitem").filter({ hasText: title });
  const assignButton = page.getByRole("button", { name: /^Assign/ });
  assert.equal(await assignButton.count(), 0);

  await row("Counter Sunk Head").getByRole("checkbox").click();
  await row("Hex drive x4").getByRole("checkbox").click();
  await page.getByRole("button", { name: "Assign 2 parts" }).click();

  const sheet = page.getByRole("dialog", { name: "Assign 2 parts" });
  await sheet.waitFor();
  assert.deepEqual(await choices(page), [
    {
      text: "Any 3D PrintingWhoever runs 3D Printing claims them first3",
      disabled: false,
    },
    { text: "Printer 1Idle0", disabled: false },
    { text: "Printer 2Running · Sam Park2", disabled: false },
    { text: "Printer 3Needs maintenance0", disabled: true },
  ]);
  await sheet.getByText("Numbers are parts already queued.").waitFor();

  await sheet.getByRole("button", { name: /Printer 1/ }).click();
  await sheet.waitFor({ state: "detached" });
  assert.deepEqual(
    calls.find((call) => call.path === "/api/kanban/cards/assign-machine"),
    {
      method: "POST",
      path: "/api/kanban/cards/assign-machine",
      body: { cardIds: ["sunk", "hex"], machineId: "printer-1" },
    }
  );
  // The selection clears once the parts are assigned.
  assert.equal(await assignButton.count(), 0);

  // "Any <process>" leaves the parts in their process queue.
  await row("Sorting Grid").getByRole("checkbox").click();
  await page.getByRole("button", { name: "Assign 1 part" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Any 3D Printing/ })
    .click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.deepEqual(
    calls
      .filter((call) => call.path === "/api/kanban/cards/assign-machine")
      .at(-1)?.body,
    { cardIds: ["grid"], machineId: null }
  );

  // Parts with no process in common: no machine takes them all.
  await row("Counter Sunk Head").getByRole("checkbox").click();
  await row("Side Plate").getByRole("checkbox").click();
  await page.getByRole("button", { name: "Assign 2 parts" }).click();
  await page
    .getByRole("dialog")
    .getByText("No machine can make all of these parts.")
    .waitFor();
  assert.deepEqual(
    (await choices(page)).map((choice) => choice.text),
    ["No machineBack to each part's process queue"]
  );
  await page.close();
});

test("search in the header finds any backlog part by name", async () => {
  const { page } = await open();
  assert.equal(await page.getByRole("searchbox").count(), 0);
  await page.getByRole("button", { name: "Search parts" }).click();
  const search = page.getByRole("searchbox", { name: "Search parts" });
  await search.fill("bush");
  // Bushing has a machine, so the default filter would hide it.
  assert.deepEqual(await groups(page), [
    { group: "3D Printing", parts: ["Bushing"] },
  ]);
  await search.fill("nothing like this");
  await page
    .getByText("No backlog part matches “nothing like this”.")
    .waitFor();
  await page.getByRole("button", { name: "Close search" }).click();
  assert.equal((await groups(page)).length, 3);
  await page.close();
});
