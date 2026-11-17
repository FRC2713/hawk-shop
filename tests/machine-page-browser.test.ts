import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("machine page shows work and SOP, reports a problem and persists numbered queue reorder", async () => {
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
      import {createRoot} from 'react-dom/client';
      import MachinePage from './src/components/islands/MachinePage';
      createRoot(document.getElementById('root')).render(<MachinePage id="printer" />);
    `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
    });
    const machine = {
      id: "printer",
      name: "Prusa",
      location: "Print room",
      processes: [{ id: "printing", name: "Printing" }],
      image_urls: ["/front.png", "/controls.png"],
      machine_status: "running",
      current_parts: [{ id: "running", title: "Wheel plate" }],
      weekly_stats: { done: 7, sent_back: 2 },
      documentation_url: "https://docs.google.com/document/d/sop",
      last_maintenance_at: null as string | null,
    };
    let queue = [
      { id: "first", title: "First part" },
      { id: "urgent", title: "Urgent part" },
    ];
    let reported = false;
    let reordered = false;
    await page.route("http://localhost:32198/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/equipment")
        return route.fulfill({ json: { equipment: [machine] } });
      if (url.pathname.endsWith("/queue"))
        return route.fulfill({ json: { cards: queue } });
      if (url.pathname === "/api/kanban/cards/running")
        return route.fulfill({
          json: {
            card: {
              assignee: "alice",
              status_history: [
                {
                  to_column_id: "in-progress",
                  moved_at: new Date(Date.now() - 7200000).toISOString(),
                },
              ],
            },
          },
        });
      if (url.pathname === "/api/users/alice")
        return route.fulfill({ json: { name: "Alice" } });
      if (url.pathname.endsWith("/maintenance")) {
        if (route.request().method() === "DELETE") {
          Object.assign(machine, {
            machine_status: "running",
            maintenance_note: null,
            maintenance_reported_at: null,
            last_maintenance_at: "2026-11-17T12:00:00Z",
          });
          return route.fulfill({ json: { equipment: machine } });
        }
        assert.deepEqual(route.request().postDataJSON(), {
          note: "Nozzle clogged",
        });
        reported = true;
        Object.assign(machine, {
          machine_status: "needs-maintenance",
          maintenance_note: "Nozzle clogged",
          maintenance_reported_by: "Alice",
          maintenance_reported_at: "2026-11-16T12:00:00Z",
        });
        return route.fulfill({ json: { equipment: machine } });
      }
      if (url.pathname.endsWith("/reorder")) {
        assert.deepEqual(route.request().postDataJSON(), {
          machineId: "printer",
          cardIds: ["urgent", "first"],
        });
        queue = [queue[1], queue[0]];
        reordered = true;
        return route.fulfill({ json: { cards: queue } });
      }
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    });
    await page.goto("http://localhost:32198/equipment/printer");
    const styles = globSync("dist/client/_astro/AppLayout.*.css");
    assert.ok(styles.length, "Build before browser tests");
    await page.addStyleTag({ content: readFileSync(styles[0], "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(
      page.getByRole("heading", { name: "Prusa", exact: true })
    ).toBeVisible();
    await expect(page.getByText("Print room")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Prusa photo 2" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open SOP" })).toHaveAttribute(
      "href",
      machine.documentation_url
    );
    await expect(
      page.getByRole("region", { name: "Now", exact: true })
    ).toContainText("Wheel plate");
    await expect(
      page.getByRole("region", { name: "Now", exact: true })
    ).toContainText("Alice");
    await expect(
      page.getByRole("region", { name: "Now", exact: true })
    ).toContainText("2 hours");
    await expect(page.getByRole("region", { name: "This week" })).toContainText(
      "7 parts done"
    );
    await expect(page.getByRole("region", { name: "This week" })).toContainText(
      "2 sent back"
    );
    const maintenance = page.getByRole("region", {
      name: "Last maintenance",
      exact: true,
    });
    await expect(maintenance).toContainText("No maintenance date recorded.");
    await page.getByRole("button", { name: "Move Urgent part up" }).click();
    await expect(
      page
        .getByRole("list", { name: "Machine queue" })
        .getByRole("listitem")
        .first()
    ).toContainText("Urgent part");
    assert.equal(reordered, true);
    await page
      .getByRole("button", { name: "Report a problem", exact: true })
      .click();
    await page.getByLabel("Problem note").fill("Nozzle clogged");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Nozzle clogged")).toBeVisible();
    assert.equal(reported, true);
    await expect(maintenance).toContainText("No maintenance date recorded.");
    await page.getByRole("button", { name: "Mark fixed", exact: true }).click();
    await expect(maintenance.locator("time")).toHaveAttribute(
      "datetime",
      "2026-11-17T12:00:00Z"
    );
    await page
      .getByRole("button", { name: "Report a problem", exact: true })
      .click();
    await page.getByLabel("Problem note").fill("Nozzle clogged");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Nozzle clogged")).toBeVisible();
    await expect(maintenance.locator("time")).toHaveAttribute(
      "datetime",
      "2026-11-17T12:00:00Z"
    );
    await expect(
      page.getByRole("link", { name: "Edit equipment" })
    ).toHaveAttribute("href", "/equipment/printer/edit");
    machine.documentation_url = "";
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(maintenance.locator("time")).toHaveAttribute(
      "datetime",
      "2026-11-17T12:00:00Z"
    );
    await expect(
      page.getByRole("link", { name: "Add SOP link" })
    ).toHaveAttribute("href", "/equipment/printer/edit");
    await expect(
      page
        .getByRole("list", { name: "Machine queue" })
        .getByRole("listitem")
        .first()
    ).toContainText("Urgent part");
  } finally {
    await browser.close();
  }
});

test("machine deletion counts all linked cards and requires confirmation", async () => {
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
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import MachinePage from './src/components/islands/MachinePage';
    createRoot(document.getElementById('root')).render(<MachinePage id="printer" />);
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let deleted = 0;
    await page.route("http://localhost:32198/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (
        path === "/api/equipment/printer" &&
        route.request().method() === "DELETE"
      ) {
        deleted++;
        return route.fulfill({ json: { success: true } });
      }
      if (path === "/api/equipment")
        return route.fulfill({
          json: {
            equipment: [
              {
                id: "printer",
                name: "Prusa",
                processes: [],
                image_urls: [],
                current_parts: [],
                weekly_stats: { done: 0, sent_back: 0 },
                machine_status: "idle",
              },
            ],
          },
        });
      if (path === "/api/kanban/cards")
        return route.fulfill({
          json: {
            cards: [
              { id: "queued", machine_id: "printer", column_id: "backlog" },
              { id: "done", machine_id: "printer", column_id: "done" },
              { id: "other", machine_id: "other", column_id: "backlog" },
              { id: "unassigned", machine_id: null, column_id: "backlog" },
            ],
          },
        });
      if (path.endsWith("/queue"))
        return route.fulfill({ json: { cards: [] } });
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    });
    await page.goto("http://localhost:32198/equipment/printer");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page
      .getByRole("button", { name: "Delete equipment", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("2 cards go back to no machine");
    await expect(dialog).toContainText("This can't be undone.");
    assert.equal(deleted, 0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    assert.equal(deleted, 0);
    await page
      .getByRole("button", { name: "Delete equipment", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Delete equipment", exact: true })
      .click();
    await expect(page).toHaveURL("http://localhost:32198/equipment");
    assert.equal(deleted, 1);
  } finally {
    await browser.close();
  }
});
