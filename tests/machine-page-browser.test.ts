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
    await expect(
      page.getByRole("link", { name: "Edit equipment" })
    ).toHaveAttribute("href", "/equipment/printer/edit");
    machine.documentation_url = "";
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
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
