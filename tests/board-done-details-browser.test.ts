import assert from "node:assert/strict";
import { globSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

const PORT = 32214;
const ORIGIN = `http://localhost:${PORT}`;
// The browser clock is frozen at 3 pm New York time, so "today" is fixed.
const NOW = new Date("2026-11-17T15:00:00-05:00");

const base = {
  title: "Part",
  image_url: null,
  assignee: null,
  date_created: "2026-11-01T12:00:00.000Z",
  date_updated: "2026-11-17T12:00:00.000Z",
  machine: null,
  machine_id: null,
  queue_position: null,
  due_date: null,
  content: null,
  release_issues: null,
  created_by: null,
  quantity_per_robot: null,
  quantity_to_make: 2,
  onshape_document_id: null,
  onshape_instance_type: null,
  onshape_instance_id: null,
  onshape_element_id: null,
  onshape_part_id: null,
  onshape_version_id: null,
  onshape_microversion_id: null,
  onshape_material: "",
  onshape_version_name: "V1",
  project_id: "project-miscellaneous",
  project: { id: "project-miscellaneous", name: "Miscellaneous" },
  processes: [],
  linked_machine: null,
  review_notes: [],
};

const columns = [
  { id: "backlog", title: "Backlog" },
  { id: "in-progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
];

let browser: Browser;
let script: string;
let styles: string[];

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
    import { createRoot } from 'react-dom/client';
    import Board from './src/components/islands/Board';
    createRoot(document.getElementById('root')).render(<Board />);
  `,
    },
  });
  script = bundle.outputFiles[0].text;
  styles = await Promise.all(
    globSync("dist/client/_astro/AppLayout.*.css").map((file) =>
      readFile(file, "utf8")
    )
  );
  browser = await chromium.launch();
});

after(() => browser.close());

type Answer = { status?: number; json: unknown };

async function openBoard(
  cards: Record<string, unknown>[],
  answer: (method: string, path: string, body: unknown) => Answer | undefined
): Promise<{ page: Page; requests: string[]; bodies: unknown[] }> {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
  });
  page.setDefaultTimeout(5000);
  await page.clock.setFixedTime(NOW);
  const requests: string[] = [];
  const bodies: unknown[] = [];
  await page.route(`${ORIGIN}/**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (!path.startsWith("/api/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    if (method !== "GET") {
      requests.push(`${method} ${path}`);
      bodies.push(request.postDataJSON());
    }
    const custom = answer(method, path, request.postDataJSON());
    if (custom)
      return route.fulfill({ status: custom.status ?? 200, json: custom.json });
    if (path === "/api/kanban/events")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (path === "/api/kanban/config")
      return route.fulfill({ json: { columns } });
    if (path === "/api/kanban/config/columns")
      return route.fulfill({ json: columns });
    if (path === "/api/kanban/cards") return route.fulfill({ json: { cards } });
    if (path.startsWith("/api/kanban/cards/")) {
      const id = path.split("/")[4];
      const card = cards.find((c) => c.id === id);
      return route.fulfill({ json: { card: { ...card, status_history: [] } } });
    }
    if (path === "/api/users")
      return route.fulfill({
        json: [{ onshape_user_id: "sam", name: "Sam" }],
      });
    if (path === "/api/projects")
      return route.fulfill({
        json: {
          projects: [
            {
              id: "project-miscellaneous",
              name: "Miscellaneous",
              archived_at: null,
              card_count: cards.length,
            },
          ],
        },
      });
    if (path === "/api/processes")
      return route.fulfill({ json: { processes: [] } });
    if (path === "/api/equipment")
      return route.fulfill({ json: { equipment: [] } });
    return route.fulfill({ status: 404, json: { error: "Not stubbed" } });
  });
  await page.goto(`${ORIGIN}/kanban`);
  for (const content of styles) await page.addStyleTag({ content });
  await page.addScriptTag({ content: script });
  return { page, requests, bodies };
}

function card(id: string, overrides: Record<string, unknown>) {
  return { ...base, id, title: id, ...overrides };
}

test("Done shows today's parts and links to the older ones", async () => {
  const { page } = await openBoard(
    [
      card("Finished this morning", {
        column_id: "done",
        date_updated: "2026-11-17T06:00:00-05:00",
      }),
      // Within 24 hours, but yesterday.
      card("Finished last night", {
        column_id: "done",
        date_updated: "2026-11-16T20:00:00-05:00",
      }),
      card("Finished last week", {
        column_id: "done",
        date_updated: "2026-11-10T12:00:00-05:00",
      }),
    ],
    () => undefined
  );
  try {
    const done = page.getByRole("region", { name: "Done today" });
    await expect(done.getByText("Finished this morning")).toBeVisible();
    await expect(done.getByText("Finished last night")).toHaveCount(0);
    await expect(done.getByText("Finished last week")).toHaveCount(0);
    await expect(
      done.getByRole("button", { name: "View 2 older cards" })
    ).toBeVisible();
  } finally {
    await page.close();
  }
});

async function openDetails(page: Page, title: string) {
  await page.getByRole("heading", { name: title, exact: true }).click();
  const panel = page.getByRole("dialog", { name: title });
  await expect(panel).toBeVisible();
  return panel;
}

test("a Backlog part's details offer Claim", async () => {
  const backlog = card("Bracket", { column_id: "backlog" });
  const { page, requests } = await openBoard([backlog], (method, path) =>
    method === "POST" && path.endsWith("/claim")
      ? { json: { card: { ...backlog, column_id: "in-progress" } } }
      : undefined
  );
  try {
    const panel = await openDetails(page, "Bracket");
    await expect(panel.getByRole("button", { name: "Unclaim" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Claim", exact: true }).click();
    await expect
      .poll(() => requests)
      .toContain("POST /api/kanban/cards/Bracket/claim");
  } finally {
    await page.close();
  }
});

test("an In Progress part's details offer Unclaim and Done", async () => {
  const part = card("Spacer", { column_id: "in-progress", assignee: "sam" });
  const { page, requests } = await openBoard([part], (method, path) =>
    method === "POST"
      ? { json: { card: { ...part, column_id: "review" } } }
      : undefined
  );
  try {
    const panel = await openDetails(page, "Spacer");
    await expect(
      panel.getByRole("button", { name: "Claim", exact: true })
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "Unclaim" }).click();
    await panel.getByRole("button", { name: "Done, send to review" }).click();
    await expect
      .poll(() => requests)
      .toEqual([
        "POST /api/kanban/cards/Spacer/unclaim",
        "POST /api/kanban/cards/Spacer/done",
      ]);
  } finally {
    await page.close();
  }
});

test("a Review part is approved, or sent back with a reason", async () => {
  const part = card("Gusset", { column_id: "review", assignee: "sam" });
  const { page, requests, bodies } = await openBoard([part], (method, path) =>
    method === "POST" ? { json: { card: part } } : undefined
  );
  try {
    const panel = await openDetails(page, "Gusset");
    await panel.getByRole("button", { name: "Send back" }).click();
    const dialog = page.getByRole("dialog", { name: 'Send back "Gusset"' });
    const submit = dialog.getByRole("button", { name: "Send back" });
    await expect(submit).toBeDisabled();
    await dialog
      .getByLabel("Why is it going back?")
      .fill("Holes are 0.5 mm small");
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await panel.getByRole("button", { name: "Approve" }).click();
    await expect
      .poll(() => requests)
      .toEqual([
        "POST /api/kanban/cards/Gusset/send-back",
        "POST /api/kanban/cards/Gusset/approve",
      ]);
    assert.deepEqual(bodies[0], { reason: "Holes are 0.5 mm small" });
  } finally {
    await page.close();
  }
});

test("a refused action shows the server's reason", async () => {
  const part = card("Plate", { column_id: "backlog" });
  const { page } = await openBoard([part], (method, path) =>
    path.endsWith("/claim")
      ? { status: 409, json: { error: "Someone else claimed this part" } }
      : undefined
  );
  try {
    const panel = await openDetails(page, "Plate");
    await panel.getByRole("button", { name: "Claim", exact: true }).click();
    await expect(
      page.getByText("Someone else claimed this part")
    ).toBeVisible();
  } finally {
    await page.close();
  }
});

test("Delete is in the overflow menu and asks first", async () => {
  const part = card("Shaft", { column_id: "done" });
  const { page, requests } = await openBoard([part], (method) =>
    method === "DELETE" ? { json: { success: true } } : undefined
  );
  try {
    const panel = await openDetails(page, "Shaft");
    await expect(panel.getByRole("button", { name: /delete/i })).toHaveCount(0);
    await panel.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete card" }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Delete this card?",
    });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    assert.deepEqual(requests, []);
    await panel.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete card" }).click();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect
      .poll(() => requests)
      .toEqual(["DELETE /api/kanban/cards/Shaft"]);
  } finally {
    await page.close();
  }
});
