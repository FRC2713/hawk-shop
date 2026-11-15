import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

test("card details show material and version from the card, backfilling only cards without a snapshot", async () => {
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
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { Sheet } from './src/components/ui/sheet';
    import { KanbanCardDetails } from './src/components/mfg/kanban/cards/KanbanCardDetails';
    const base = {
      column_id: 'todo', title: 'BRACKET', image_url: null, assignee: null,
      date_created: '2026-01-01T00:00:00.000Z', date_updated: '2026-01-01T00:00:00.000Z',
      machine: null, due_date: null, content: null, release_issues: null,
      created_by: null, quantity_per_robot: null, quantity_to_make: 2,
      onshape_document_id: 'doc', onshape_instance_type: 'v',
      onshape_instance_id: 'version', onshape_element_id: 'studio',
      onshape_part_id: 'part', onshape_version_id: 'version',
      onshape_microversion_id: null, project_id: 'project-miscellaneous',
      processes: [],
    };
    window.show = (overrides) => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}><Sheet open>
          <KanbanCardDetails card={{...base, ...overrides}}
            deleteCardMutation={{isPending: false}} onDelete={() => {}}
            usersMap={new Map()} />
        </Sheet></QueryClientProvider>);
    };
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    let requests: string[] = [];
    let snapshotAnswer: unknown = {};
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      requests.push(`${route.request().method()} ${url.pathname}`);
      if (url.pathname.endsWith("/snapshot"))
        return route.fulfill({ json: snapshotAnswer });
      if (url.pathname.startsWith("/api/kanban/cards/"))
        return route.fulfill({ json: { card: { status_history: [] } } });
      return route.fulfill({ json: [] });
    });
    await page.route("http://localhost:32198/", (route) =>
      route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
    );
    async function show(id: string, overrides: Record<string, unknown>) {
      requests = [];
      await page.goto("http://localhost:32198");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate((card) => (window as any).show(card), {
        id,
        ...overrides,
      });
      await page.getByRole("dialog").waitFor();
    }
    const onshapeOrSnapshot = (request: string) =>
      request.includes("/api/onshape/") || request.endsWith("/snapshot");
    const row = (label: string) =>
      page
        .getByRole("row")
        .filter({ has: page.getByText(label, { exact: true }) });

    await show("snapshotted", {
      onshape_material: "6061 Aluminum",
      onshape_version_name: "V3 Ready",
    });
    await row("Material").getByText("6061 Aluminum").waitFor();
    await row("Version").getByText("V3 Ready").waitFor();
    await page.waitForTimeout(200);
    assert.deepEqual(requests.filter(onshapeOrSnapshot), []);

    await show("not-set", {
      onshape_material: "",
      onshape_version_name: "V3 Ready",
    });
    await row("Material").getByText("Not set").waitFor();

    snapshotAnswer = {
      onshape_material: "Delrin",
      onshape_version_name: "Season start",
    };
    await show("legacy", {
      onshape_material: null,
      onshape_version_name: null,
    });
    await row("Material").getByText("Delrin").waitFor();
    await row("Version").getByText("Season start").waitFor();
    assert.deepEqual(requests.filter(onshapeOrSnapshot), [
      "POST /api/kanban/cards/legacy/snapshot",
    ]);

    snapshotAnswer = { onshape_material: null, onshape_version_name: null };
    await show("offline", {
      onshape_material: null,
      onshape_version_name: null,
    });
    await row("Material").getByText("Unknown").waitFor();
    await row("Version").getByText("Unknown").waitFor();
  } finally {
    await browser.close();
  }
});
