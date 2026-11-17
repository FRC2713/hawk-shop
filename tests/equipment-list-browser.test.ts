import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("phone equipment groups every process and filters maintenance and missing photos while retaining add and process management", async () => {
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
      viewport: { width: 390, height: 844 },
      colorScheme: "dark",
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
      },
      {
        id: "combo",
        name: "Combo",
        processes: [printing, milling],
        image_urls: [],
        status: "maintenance",
        machine_status: "needs-maintenance",
        queue_size: 1,
      },
      {
        id: "unassigned",
        name: "Loose tool",
        processes: [],
        image_urls: null,
        status: null,
        machine_status: "idle",
        queue_size: 0,
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
    const printingGroup = page.getByRole("region", {
      name: "Printing",
      exact: true,
    });
    const millingGroup = page.getByRole("region", {
      name: "Milling",
      exact: true,
    });
    await expect(
      printingGroup.getByText("Combo", { exact: true })
    ).toBeVisible();
    await expect(
      millingGroup.getByText("Combo", { exact: true })
    ).toBeVisible();
    await expect(
      printingGroup.getByText("Running", { exact: true })
    ).toBeVisible();
    const add = page.getByRole("link", { name: "Add equipment", exact: true });
    await expect(add).toHaveCSS("position", "fixed");
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await expect(printingGroup.locator("img")).toHaveAttribute(
      "src",
      "/front.png"
    );
    await expect(
      printingGroup.getByRole("link").filter({ hasText: "Printer" })
    ).toHaveAttribute("href", "/equipment/printer");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      ),
      true
    );
    await expect(
      printingGroup.getByText("3 queued", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "No process", exact: true })
    ).toContainText("Idle");
    await page.getByRole("button", { name: /^Needs maintenance/ }).click();
    await expect(
      printingGroup.getByText("Printer", { exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "No process", exact: true })
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^No photo/ }).click();
    await expect(
      page.getByRole("region", { name: "No process", exact: true })
    ).toContainText("Loose tool");
    await expect(
      printingGroup.getByText("Printer", { exact: true })
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(
      printingGroup.getByText("Printer", { exact: true })
    ).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search equipment" })
      .fill("missing machine");
    await expect(
      page.getByText("No equipment matches", { exact: true })
    ).toBeVisible();
    assert.ok(
      (await page
        .getByRole("link", { name: "Add equipment", exact: true })
        .first()
        .getAttribute("href")) === "/equipment/new"
    );
    await expect(
      page.getByRole("heading", { name: "Manufacturing Processes" })
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(add).toHaveCSS("position", "static");
    await expect(page.getByRole("complementary")).toBeVisible();
  } finally {
    await browser.close();
  }
});
