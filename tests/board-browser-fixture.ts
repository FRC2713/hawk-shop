import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import type { Browser, Page } from "@playwright/test";

/**
 * Shared harness for board island browser tests: the bundled Board island,
 * a stubbed API and card rows with every field the server returns. Each test
 * file passes its own port so files can run in parallel.
 */

const HOUR = 60 * 60 * 1000;
export const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();

export const BOARD_COLUMNS = [
  { id: "backlog", title: "Backlog", position: 0 },
  { id: "in-progress", title: "In Progress", position: 1 },
  { id: "review", title: "Review", position: 2 },
  { id: "done", title: "Done", position: 3 },
];

export const PRINTING = {
  id: "printing",
  name: "3D Printing",
  icon: null,
  color: null,
};

export function boardCard(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    column_id: "backlog",
    title: id,
    image_url: null,
    assignee: null,
    date_created: ago(48),
    date_updated: ago(1),
    machine: null,
    machine_id: null,
    queue_position: null,
    due_date: null,
    content: null,
    release_issues: null,
    created_by: null,
    quantity_per_robot: null,
    quantity_to_make: 1,
    onshape_document_id: "doc",
    onshape_instance_type: "v",
    onshape_instance_id: "version",
    onshape_element_id: "studio",
    onshape_part_id: "part",
    onshape_version_id: "version",
    onshape_microversion_id: null,
    onshape_material: "",
    onshape_version_name: "V1",
    project_id: "project-miscellaneous",
    processes: [],
    project: {
      id: "project-miscellaneous",
      name: "Miscellaneous",
      archived_at: null,
    },
    linked_machine: null,
    review_notes: [],
    ...overrides,
  };
}

export interface BoardData {
  cards: Record<string, unknown>[];
  users?: { onshape_user_id: string; name: string }[];
  processes?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  equipment?: Record<string, unknown>[];
}

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let boardBundle: Promise<string> | undefined;
function bundleBoard() {
  boardBundle ??= build({
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
      import {createRoot} from 'react-dom/client';
      import Board from './src/components/islands/Board';
      createRoot(document.getElementById('root')).render(<Board />);
    `,
    },
  }).then((result) => result.outputFiles[0].text);
  return boardBundle;
}

/**
 * Loads the board at `path` with `data` behind the API. Requests other than
 * the stubbed reads are recorded as "METHOD /path" in the returned array.
 */
export async function openBoard(
  page: Page,
  port: number,
  data: BoardData,
  path = "/kanban"
) {
  const requests: string[] = [];
  await page.unroute(`http://localhost:${port}/**`);
  await page.route(`http://localhost:${port}/**`, (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) => route.fulfill({ json: body });
    switch (url.pathname) {
      case "/api/kanban/config":
        return json({ columns: BOARD_COLUMNS });
      case "/api/kanban/config/columns":
        return json(BOARD_COLUMNS);
      case "/api/kanban/cards":
        return json({ cards: data.cards });
      case "/api/users":
        return json(data.users ?? []);
      case "/api/processes":
        return json({ processes: data.processes ?? [PRINTING] });
      case "/api/projects":
        return json({ projects: data.projects ?? [] });
      case "/api/equipment":
        return json({ equipment: data.equipment ?? [] });
      case "/api/kanban/events":
        return route.fulfill({ contentType: "text/event-stream", body: "" });
    }
    if (url.pathname.startsWith("/api/onshape/thumbnail"))
      return route.fulfill({ contentType: "image/png", body: PIXEL });
    if (url.pathname.startsWith("/api/")) {
      requests.push(`${route.request().method()} ${url.pathname}`);
      return json({ card: { status_history: [] } });
    }
    return route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div>',
    });
  });
  await page.goto(`http://localhost:${port}${path}`);
  const styles = globSync("dist/client/_astro/AppLayout.*.css");
  assert.ok(styles.length, "Build before browser tests");
  await page.addStyleTag({ content: readFileSync(styles[0], "utf8") });
  await page.addScriptTag({ content: await bundleBoard() });
  return requests;
}

/** The card face titled `title`; a click opens its details. */
export function boardCardFace(page: Page, title: string) {
  return page.getByRole("button", { name: title, exact: true });
}

/** A browser with one 1440 x 900 page. */
export async function launchBoardBrowser(chromium: {
  launch: () => Promise<Browser>;
}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(5000);
  return { browser, page };
}
