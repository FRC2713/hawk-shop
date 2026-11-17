import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import type { Browser, Page } from "@playwright/test";

/**
 * Shared harness for desktop board browser tests: the real Board island
 * bundled with esbuild, a stubbed API and real built styles (run
 * `npm run build` first). Each test file passes its own port.
 */

export const boardColumns = [
  { id: "backlog", title: "Backlog", position: 0 },
  { id: "in-progress", title: "In Progress", position: 1 },
  { id: "review", title: "Review", position: 2 },
  { id: "done", title: "Done", position: 3 },
];

export const boardUsers = [
  { onshape_user_id: "alice", name: "Alice Ng", email: null },
  { onshape_user_id: "bob", name: "Bob Ruiz", email: null },
];

export const boardProjects = [
  { id: "drivetrain", name: "Drivetrain", archived_at: null, card_count: 2 },
  { id: "intake", name: "Intake", archived_at: null, card_count: 1 },
];

export const boardProcesses = [
  { id: "milling", name: "CNC Milling", description: null },
  { id: "printing", name: "3D Printing", description: null },
];

export const boardEquipment = [
  {
    id: "router",
    name: "Router",
    status: "active",
    processes: [boardProcesses[0]],
    machine_status: "idle",
    queue_size: 1,
    current_parts: [],
  },
  {
    id: "printer",
    name: "Printer 2",
    status: "active",
    processes: [boardProcesses[1]],
    machine_status: "idle",
    queue_size: 1,
    current_parts: [],
  },
];

const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3600_000).toISOString();

export function boardCard(
  overrides: Record<string, unknown> & { id: string; title: string }
) {
  return {
    column_id: "backlog",
    image_url: null,
    assignee: null,
    date_created: hoursAgo(48),
    date_updated: hoursAgo(2),
    machine: null,
    machine_id: null,
    queue_position: null,
    due_date: null,
    content: null,
    release_issues: null,
    created_by: null,
    quantity_per_robot: null,
    quantity_to_make: 2,
    onshape_document_id: "doc",
    onshape_instance_type: "v",
    onshape_instance_id: "version",
    onshape_element_id: "studio",
    onshape_part_id: "part",
    onshape_version_id: "version",
    onshape_microversion_id: null,
    onshape_material: "",
    onshape_version_name: "V1",
    project_id: "drivetrain",
    processes: [],
    project: boardProjects[0],
    linked_machine: null,
    review_notes: [],
    ...overrides,
  };
}

export async function bundleBoard() {
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
      import Board from './src/components/islands/Board';
      const cardId = new URL(location.href).searchParams.get('cardId') || undefined;
      createRoot(document.getElementById('root')).render(<Board cardId={cardId} />);
    `,
    },
  });
  return bundle.outputFiles[0].text;
}

export type BoardStub = {
  cards: ReturnType<typeof boardCard>[];
  /** Every API request as `METHOD /path`. */
  requests: string[];
};

/**
 * Open `/kanban<search>` on a stubbed origin and mount the board. Returns the
 * stub so a test can change cards or read the request log.
 */
export async function openBoard(
  browser: Browser,
  {
    port,
    script,
    cards,
    search = "",
  }: {
    port: number;
    script: string;
    cards: ReturnType<typeof boardCard>[];
    search?: string;
  }
): Promise<{ page: Page; stub: BoardStub; reload: () => Promise<void> }> {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(5000);
  const stub: BoardStub = { cards, requests: [] };
  await page.route(`http://localhost:${port}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith("/api/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    stub.requests.push(`${route.request().method()} ${path}`);
    if (path === "/api/kanban/events")
      return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (path === "/api/kanban/config")
      return route.fulfill({ json: { columns: boardColumns } });
    if (path === "/api/kanban/config/columns")
      return route.fulfill({ json: boardColumns });
    if (path === "/api/kanban/cards")
      return route.fulfill({ json: { cards: stub.cards } });
    if (path.startsWith("/api/kanban/cards/")) {
      const id = decodeURIComponent(path.split("/")[4]);
      const card = stub.cards.find((candidate) => candidate.id === id);
      return route.fulfill({ json: { card: { ...card, status_history: [] } } });
    }
    if (path === "/api/users") return route.fulfill({ json: boardUsers });
    if (path === "/api/projects")
      return route.fulfill({ json: { projects: boardProjects } });
    if (path === "/api/processes")
      return route.fulfill({ json: { processes: boardProcesses } });
    if (path === "/api/equipment")
      return route.fulfill({ json: { equipment: boardEquipment } });
    if (path.startsWith("/api/onshape/thumbnail"))
      return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 404, json: { error: "not stubbed" } });
  });
  const styles = globSync("dist/client/_astro/AppLayout.*.css");
  assert.ok(styles.length, "Build before browser tests");
  const css = readFileSync(styles[0], "utf8");
  const mount = async () => {
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
  };
  await page.goto(`http://localhost:${port}/kanban${search}`);
  await mount();
  return {
    page,
    stub,
    reload: async () => {
      await page.reload();
      await mount();
    },
  };
}
