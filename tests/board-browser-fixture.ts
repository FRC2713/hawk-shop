import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import type { Browser, Page, Request } from "@playwright/test";

/**
 * Shared harness for desktop board browser tests: the real Board island
 * bundled with esbuild, a stubbed API and real built styles (run
 * `npm run build` first). Each test file passes its own port.
 */

const HOUR = 60 * 60 * 1000;
/** An ISO timestamp `hours` before now. */
export const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();

export const boardColumns = [
  { id: "backlog", title: "Backlog", position: 0 },
  { id: "in-progress", title: "In Progress", position: 1 },
  { id: "review", title: "Review", position: 2 },
  { id: "done", title: "Done", position: 3 },
];
export const BOARD_COLUMNS = boardColumns;

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

export const PRINTING = {
  id: "printing",
  name: "3D Printing",
  icon: null,
  color: null,
};

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

type CardOverrides = Record<string, unknown>;
export type BoardCard = Record<string, unknown> & { id: string; title: string };

/**
 * A card row with every field the server returns. Call it with
 * `{ id, title, ...overrides }`, or with a title (also used as the id) and
 * overrides.
 */
export function boardCard(
  overrides: CardOverrides & { id: string; title: string }
): BoardCard;
export function boardCard(title: string, overrides?: CardOverrides): BoardCard;
export function boardCard(
  first: string | (CardOverrides & { id: string; title: string }),
  rest: CardOverrides = {}
): BoardCard {
  const overrides =
    typeof first === "string" ? { id: first, title: first, ...rest } : first;
  return {
    column_id: "backlog",
    image_url: null,
    assignee: null,
    date_created: ago(48),
    date_updated: ago(2),
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

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let boardBundle: Promise<string> | undefined;
/** The Board island as one script; built once per test process. */
export function bundleBoard() {
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
      import { createRoot } from 'react-dom/client';
      import Board from './src/components/islands/Board';
      const cardId = new URL(location.href).searchParams.get('cardId') || undefined;
      createRoot(document.getElementById('root')).render(<Board cardId={cardId} />);
    `,
    },
  }).then((result) => result.outputFiles[0].text);
  return boardBundle;
}

/** A browser with one 1440 x 900 page. */
export async function launchBoardBrowser(chromium: {
  launch: () => Promise<Browser>;
}) {
  const browser = await chromium.launch();
  const page = await newBoardPage(browser);
  return { browser, page };
}

async function newBoardPage(browser: Browser) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(5000);
  return page;
}

/** The card face titled `title`; a click opens its details. */
export function boardCardFace(page: Page, title: string) {
  return page.getByRole("button", { name: title, exact: true });
}

export type BoardStub = {
  cards: BoardCard[];
  /** Every API request as `METHOD /path`. */
  requests: string[];
};

export interface OpenBoardOptions {
  port: number;
  cards: BoardCard[];
  /** The bundled island; defaults to `bundleBoard()`. */
  script?: string;
  /** Query string for `/kanban`, e.g. `?project=intake`. */
  search?: string;
  users?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  processes?: Record<string, unknown>[];
  equipment?: Record<string, unknown>[];
  /**
   * Answers a write (any non-GET request) before the defaults. Return
   * undefined to fall through to them.
   */
  answer?: (
    request: Request,
    path: string
  ) => { status?: number; json: unknown } | undefined;
}

/**
 * Open `/kanban<search>` on a stubbed origin and mount the board. Pass a
 * browser for a new 1440 x 900 page, or a page to load it again there.
 * Returns the stub so a test can change cards or read the request log.
 */
export async function openBoard(
  target: Browser | Page,
  options: OpenBoardOptions
): Promise<{ page: Page; stub: BoardStub; reload: () => Promise<void> }> {
  const { port, search = "" } = options;
  const page =
    "newPage" in target ? await newBoardPage(target as Browser) : target;
  const script = options.script ?? (await bundleBoard());
  const users = options.users ?? boardUsers;
  const projects = options.projects ?? boardProjects;
  const processes = options.processes ?? boardProcesses;
  const equipment = options.equipment ?? boardEquipment;
  const stub: BoardStub = { cards: options.cards, requests: [] };
  await page.unroute(`http://localhost:${port}/**`);
  await page.route(`http://localhost:${port}/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith("/api/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    stub.requests.push(`${route.request().method()} ${path}`);
    const answered =
      route.request().method() === "GET"
        ? undefined
        : options.answer?.(route.request(), path);
    if (answered)
      return route.fulfill({
        status: answered.status ?? 200,
        json: answered.json,
      });
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
    if (path === "/api/users") return route.fulfill({ json: users });
    if (path === "/api/projects") return route.fulfill({ json: { projects } });
    if (path === "/api/processes")
      return route.fulfill({ json: { processes } });
    if (path === "/api/equipment")
      return route.fulfill({ json: { equipment } });
    if (path.startsWith("/api/onshape/thumbnail"))
      return route.fulfill({ contentType: "image/png", body: PIXEL });
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
