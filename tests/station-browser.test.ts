import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

async function stationFixture(processId: string | null = "printing") {
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
      import Station from './src/components/islands/Station';
      createRoot(document.getElementById('root')).render(<Station processId={${JSON.stringify(processId)}} />);
    `,
    },
  });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  });
  await page.clock.install();
  // The browser EventSource boundary can deliver events without a live server.
  await page.addInitScript({
    content: `
    class FixtureEventSource extends EventTarget {
      constructor() {
        super();
        window.addEventListener("fixture-station-change", () => this.dispatchEvent(new Event("change")));
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEventSource });
  `,
  });
  const machines = [
    {
      id: "z",
      name: "Zulu printer",
      machine_status: "needs-maintenance",
      maintenance_note: "Heater cable broken",
      current_parts: [],
      processes: [{ id: "printing" }],
    },
    {
      id: "a",
      name: "Alpha printer",
      machine_status: "running",
      current_parts: [{ id: "part", title: "Wheel plate" }],
      processes: [{ id: "printing" }],
      documentation_url: "https://example.com/sop",
    },
    {
      id: "b",
      name: "Beta printer",
      machine_status: "idle",
      current_parts: [],
      processes: [{ id: "printing" }],
    },
    {
      id: "mill",
      name: "Mill",
      machine_status: "idle",
      current_parts: [],
      processes: [{ id: "milling" }],
    },
  ];
  let nextTitle = "Spare bracket";
  await page.route("http://localhost:32198/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/processes")
      return route.fulfill({
        json: {
          processes: [
            { id: "printing", name: "3D Printing" },
            { id: "milling", name: "Milling" },
          ],
        },
      });
    if (path === "/api/equipment")
      return route.fulfill({ json: { equipment: machines } });
    if (path.endsWith("/queue"))
      return route.fulfill({
        json: {
          cards: [1, 2, 3, 4].map((n) => ({
            id: `next-${n}`,
            title: n === 1 ? nextTitle : `Queued ${n}`,
            quantity_to_make: n,
          })),
        },
      });
    if (path === "/api/kanban/cards/part")
      return route.fulfill({
        json: {
          card: {
            id: "part",
            assignee: "alice",
            quantity_to_make: 6,
            status_history: [
              {
                to_column_id: "in-progress",
                moved_at: new Date(Date.now() - 7200000).toISOString(),
              },
            ],
          },
        },
      });
    if (path === "/api/users/alice")
      return route.fulfill({ json: { name: "Alice" } });
    return route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div>',
    });
  });
  await page.goto("http://localhost:32198/station/printing");
  await page.addStyleTag({
    content: readFileSync(
      globSync("dist/client/_astro/AppLayout.*.css")[0],
      "utf8"
    ),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return {
    browser,
    page,
    machines,
    setNextTitle: (title: string) => {
      nextTitle = title;
    },
  };
}

test("station columns show running work, ordered next parts and maintenance instead of a queue", async () => {
  const { browser, page } = await stationFixture();
  try {
    await expect(
      page.getByRole("heading", { name: "3D Printing", exact: true })
    ).toBeVisible();
    const columns = page.getByRole("region", { name: /printer$/ });
    await expect(columns).toHaveCount(3);
    await expect(columns.nth(0)).toHaveAccessibleName("Alpha printer");
    await expect(columns.nth(1)).toHaveAccessibleName("Beta printer");
    const alpha = columns.nth(0);
    for (const text of [
      "Running",
      "Wheel plate",
      "Alice",
      "2 hours",
      "Quantity: 6",
      "Spare bracket",
    ])
      await expect(alpha).toContainText(text);
    await expect(alpha.getByRole("link", { name: "Open SOP" })).toHaveAttribute(
      "href",
      "https://example.com/sop"
    );
    await expect(
      alpha.getByRole("list", { name: "Up next" }).getByRole("listitem")
    ).toHaveCount(3);
    await expect(columns.nth(1)).toContainText("Idle · Work waiting");
    await expect(columns.nth(2)).toContainText("Needs maintenance");
    await expect(columns.nth(2)).toContainText("Heater cable broken");
    await expect(
      columns.nth(2).getByRole("list", { name: "Up next" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Mill", exact: true })
    ).toHaveCount(0);
    for (const column of await columns.all()) {
      const box = await column.boundingBox();
      assert.ok(
        box &&
          box.y >= 0 &&
          box.y + box.height <= 800 &&
          box.x + box.width <= 1280
      );
    }
    for (const link of [
      ...(await page.getByRole("link").all()),
      ...(await page.getByRole("button").all()),
    ])
      assert.ok(
        (await link.boundingBox())!.height >= 56,
        `${await link.innerText()}: ${JSON.stringify(await link.boundingBox())}`
      );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      1280
    );
    assert.equal(
      await page
        .locator("main")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(20, 20, 20)"
    );
    await page.getByRole("button", { name: "Change station" }).click();
    await expect(
      page.getByRole("link", { name: "Milling", exact: true })
    ).toHaveAttribute("href", "/station/milling");
  } finally {
    await browser.close();
  }
});

test("station follows live changes and recovers missed changes on its three-minute refresh", async () => {
  const { browser, page, machines, setNextTitle } = await stationFixture();
  try {
    const beta = page.getByRole("region", {
      name: "Beta printer",
      exact: true,
    });
    await expect(beta).toContainText("Spare bracket");
    setNextTitle("Live bracket");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("fixture-station-change"))
    );
    await page.clock.runFor(100);
    await expect(beta).toContainText("Live bracket");
    setNextTitle("Recovered bracket");
    machines[2].machine_status = "needs-maintenance";
    Object.assign(machines[2], { maintenance_note: "Belt snapped" });
    await page.clock.runFor(180_000);
    await expect(beta).toContainText("Belt snapped");
    await expect(beta.getByRole("list", { name: "Up next" })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Alpha printer", exact: true })
    ).toContainText("Recovered bracket");
  } finally {
    await browser.close();
  }
});

test("station entry lists processes and offers recovery for an unknown station", async () => {
  const { browser, page } = await stationFixture(null);
  try {
    await expect(
      page.getByRole("navigation", { name: "Stations", exact: true })
    ).toBeVisible();
    await page.getByRole("link", { name: "Milling", exact: true }).click();
    await expect(page).toHaveURL("http://localhost:32198/station/milling");
  } finally {
    await browser.close();
  }
  const invalid = await stationFixture("missing");
  try {
    await expect(invalid.page.getByRole("alert")).toContainText(
      "Station not found"
    );
    await invalid.page.getByRole("button", { name: "Change station" }).click();
    await expect(
      invalid.page.getByRole("link", { name: "3D Printing", exact: true })
    ).toBeVisible();
  } finally {
    await invalid.browser.close();
  }
});
