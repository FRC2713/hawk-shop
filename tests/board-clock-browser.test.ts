import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import {
  boardCard,
  boardCardFace,
  openBoard,
  type BoardCard,
} from "./board-browser-fixture";
import { useBoardDensity } from "../src/hooks/useBoardDensity";
import { useBoardRows } from "../src/hooks/useBoardRows";

const PORT = 32216;
const ORIGIN = `http://localhost:${PORT}`;
// The browser clock starts at 3 pm New York time, so "today" is fixed.
const NOW = new Date("2026-11-17T15:00:00-05:00");
const at = (iso: string) => new Date(iso).toISOString();

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

/** A board page whose clock starts at NOW and runs only when told. */
async function openAtNow(cards: BoardCard[]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.install({ time: NOW });
  await openBoard(page, { port: PORT, cards });
  return page;
}

const checkbox = (page: Page, title: string) =>
  page.getByRole("checkbox", { name: `Select ${title}` });

async function chooseRows(page: Page, option: string) {
  await page
    .getByRole("group", { name: "View" })
    .getByRole("combobox", { name: "Rows" })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function Preferences() {
  const { density } = useBoardDensity();
  const { rowsBy } = useBoardRows();
  return createElement("output", null, `${density} ${rowsBy}`);
}

test("stored board preferences apply after hydration without a mismatch", async () => {
  // What the server sends: no storage there, so the defaults.
  const serverHtml = renderToString(createElement(Preferences));
  assert.match(serverHtml, /compact none/);

  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
      import { createElement } from 'react';
      import { hydrateRoot } from 'react-dom/client';
      import { useBoardDensity } from './src/hooks/useBoardDensity';
      import { useBoardRows } from './src/hooks/useBoardRows';
      function Preferences() {
        const { density } = useBoardDensity();
        const { rowsBy } = useBoardRows();
        return createElement('output', null, density + ' ' + rowsBy);
      }
      window.hydrationErrors = [];
      hydrateRoot(document.getElementById('root'), createElement(Preferences), {
        onRecoverableError: (error) => window.hydrationErrors.push(String(error)),
      });
    `,
    },
  });
  const page = await browser.newPage();
  try {
    await page.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<div id="root">${serverHtml}</div>`,
      })
    );
    await page.goto(ORIGIN);
    await page.evaluate(() => {
      localStorage.setItem("hawk-shop:board-density", "pictures");
      localStorage.setItem("hawk-shop:board-rows", "process");
    });
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.locator("output")).toHaveText("pictures process");
    assert.deepEqual(
      await page.evaluate(
        () =>
          (window as unknown as { hydrationErrors: string[] }).hydrationErrors
      ),
      []
    );
  } finally {
    await page.close();
  }
});

test("time in status and flags keep up while the board stays open", async () => {
  const page = await openAtNow([
    boardCard("Spacer", {
      column_id: "in-progress",
      date_updated: at("2026-11-17T14:01:00-05:00"),
    }),
    boardCard("Gusset", {
      column_id: "review",
      date_updated: at("2026-11-16T15:01:00-05:00"),
    }),
  ]);
  try {
    const spacer = boardCardFace(page, "Spacer");
    const gusset = boardCardFace(page, "Gusset");
    await expect(spacer).toContainText("59 min");
    await expect(gusset).not.toContainText("Over a day in review");

    await page.clock.runFor(2 * 60 * 1000);
    await expect(spacer).toContainText("1 h");
    await expect(gusset).toContainText("Over a day in review");
  } finally {
    await page.context().close();
  }
});

const doneCards = [
  boardCard("Finished at noon", {
    column_id: "done",
    date_updated: at("2026-11-17T12:00:00-05:00"),
  }),
  boardCard("Finished last week", {
    column_id: "done",
    date_updated: at("2026-11-10T12:00:00-05:00"),
  }),
  boardCard("Finished at one", {
    column_id: "done",
    date_updated: at("2026-11-17T13:00:00-05:00"),
  }),
];

test("shift-click in Done selects only today's parts", async () => {
  const page = await openAtNow(doneCards);
  try {
    await checkbox(page, "Finished at noon").click();
    await checkbox(page, "Finished at one").click({ modifiers: ["Shift"] });
    await expect(
      page.getByRole("toolbar", { name: "Selected cards" })
    ).toContainText("2 selected");
  } finally {
    await page.context().close();
  }
});

test("rows keep the link to older Done parts", async () => {
  const page = await openAtNow(doneCards);
  try {
    await chooseRows(page, "Project");
    await expect(boardCardFace(page, "Finished last week")).toHaveCount(0);
    const older = page.getByRole("link", { name: "View 1 older card" });
    await expect(older).toBeVisible();
    await expect(older).toHaveAttribute("href", "/kanban/done");
  } finally {
    await page.context().close();
  }
});
