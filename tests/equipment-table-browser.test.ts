import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("desktop equipment table groups machines, links rows and SOPs, and contains wide content", async () => {
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
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {EquipmentClient} from './src/components/app/equipment-client';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><EquipmentClient /></QueryClientProvider>);
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
    });
    const printing = { id: "printing", name: "Printing" };
    const milling = { id: "milling", name: "Milling" };
    const machines = [
      {
        id: "printer",
        name: "Printer",
        processes: [printing],
        image_urls: ["/front.png"],
        status: null,
        machine_status: "running",
        queue_size: 3,
        current_parts: [{ id: "part", title: "Wheel plate" }],
        weekly_stats: { done: 7, sent_back: 2 },
        documentation_url: "https://docs.google.com/document/d/printer",
      },
      {
        id: "combo",
        name: "Combo",
        processes: [printing, milling],
        image_urls: [],
        status: "maintenance",
        machine_status: "needs-maintenance",
        queue_size: 1,
        current_parts: [],
        weekly_stats: { done: 0, sent_back: 0 },
      },
      {
        id: "unassigned",
        name: "Loose tool",
        processes: [],
        image_urls: null,
        status: null,
        machine_status: "idle",
        queue_size: 0,
        current_parts: [],
        weekly_stats: { done: 0, sent_back: 0 },
      },
    ];
    await page.route("http://localhost:32198/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/equipment")
        return route.fulfill({ json: { equipment: machines } });
      if (pathname === "/api/processes")
        return route.fulfill({ json: { processes: [] } });
      if (pathname.startsWith("/api/"))
        return route.fulfill({ json: { cards: [], columns: [] } });
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    });
    await page.goto("http://localhost:32198/");
    const styles = globSync("dist/client/_astro/AppLayout.*.css");
    assert.ok(styles.length, "Run npm run build before browser tests");
    await page.addStyleTag({ content: readFileSync(styles[0], "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const printingRegion = page.getByRole("region", {
      name: "Printing",
      exact: true,
    });
    const millingRegion = page.getByRole("region", {
      name: "Milling",
      exact: true,
    });
    const table = printingRegion.getByRole("table");
    await expect(table).toBeVisible();
    for (const name of [
      "Machine",
      "Status",
      "Current part",
      "Queued",
      "Done this week",
      "SOP",
    ]) {
      await expect(
        table.getByRole("columnheader", { name, exact: true })
      ).toBeVisible();
    }
    await expect(
      millingRegion
        .getByRole("table")
        .getByRole("link", { name: "Combo", exact: true })
    ).toBeVisible();
    const printer = table.getByRole("row").filter({ hasText: "Wheel plate" });
    await expect(
      printer.getByRole("link", { name: "Printer", exact: true })
    ).toHaveAttribute("href", "/equipment/printer");
    await expect(printer).toContainText("Wheel plate");
    await expect(
      printer.getByRole("cell", { name: "7", exact: true })
    ).toBeVisible();
    await expect(
      printer.getByRole("link", { name: "Open SOP" })
    ).toHaveAttribute("href", "https://docs.google.com/document/d/printer");
    await expect(
      table.getByRole("link", { name: "Add SOP link" })
    ).toHaveAttribute("href", "/equipment/combo/edit");
    await expect(
      page.getByRole("region", { name: "No process", exact: true })
    ).toContainText("Loose tool");
    await expect(
      page.getByRole("heading", { name: "Manufacturing Processes" })
    ).toBeVisible();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    // Long names must stay inside the table's scrolling box.
    await printer
      .getByRole("link", { name: "Printer", exact: true })
      .evaluate((link) => {
        link.textContent = "Machine".repeat(200);
      });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      true
    );
    const scrollBox = printingRegion.getByRole("region", {
      name: "Printing equipment table",
    });
    await expect(scrollBox).toHaveCSS("overflow-x", "auto");
    assert.equal(
      await scrollBox.evaluate((box) => box.scrollWidth > box.clientWidth),
      true
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(table).toBeVisible();
    await printer
      .getByRole("cell", { name: "Wheel plate", exact: true })
      .click();
    await expect(page).toHaveURL("http://localhost:32198/equipment/printer");
  } finally {
    await browser.close();
  }
});
