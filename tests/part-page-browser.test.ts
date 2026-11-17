import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const viewer = "slack:TTEAM:USAM";
const card = {
  id: "bracket",
  column_id: "in-progress",
  title: "Button Head 4x Size",
  image_url: "/api/files/card-images/bracket.png",
  assignee: viewer,
  created_by: "slack:TTEAM:UJORDAN",
  date_created: "2026-11-12T15:00:00.000Z",
  date_updated: "2026-11-13T15:00:00.000Z",
  machine: null,
  machine_id: "printer-2",
  queue_position: null,
  due_date: "2026-11-20",
  content: "Check the hex socket with the 4 mm key before review.",
  release_issues: [
    {
      code: "missing_description",
      severity: "warning",
      message: "This part has no description.",
      fix: "Add one in Onshape.",
    },
  ],
  quantity_per_robot: null,
  quantity_to_make: 2,
  onshape_document_id: "doc",
  onshape_instance_type: "v",
  onshape_instance_id: "version",
  onshape_element_id: "studio",
  onshape_part_id: "part",
  onshape_version_id: "version",
  onshape_microversion_id: null,
  onshape_material: "PLA",
  onshape_version_name: "v4",
  project_id: "project-miscellaneous",
  project: {
    id: "project-miscellaneous",
    name: "Miscellaneous",
    archived_at: null,
  },
  processes: [{ id: "process-3d-printing", name: "3D Printing" }],
  linked_machine: { id: "printer-2", name: "Printer 2", status: "available" },
  review_notes: [],
  status_history: [
    {
      id: 1,
      from_status: null,
      to_status: "Backlog",
      actor_name: "Jordan",
      moved_at: "2026-11-12T15:00:00.000Z",
    },
    {
      id: 2,
      from_status: "Backlog",
      to_status: "In Progress",
      actor_name: "Sam",
      moved_at: "2026-11-13T15:00:00.000Z",
    },
  ],
};

test("the part page shows a phone-sized summary, hides history and delete until asked", async () => {
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
    import { PartPage } from './src/components/phone/PartPage';
    window.show = (cardId, viewerId) => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}>
          <PartPage cardId={cardId} viewerId={viewerId} />
        </QueryClientProvider>);
    };
  `,
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(3000);
    let requests: string[] = [];
    await page.route("**/api/**", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push(`${request.method()} ${url.pathname}`);
      if (url.pathname === "/api/kanban/cards/bracket")
        return route.fulfill({
          json: request.method() === "DELETE" ? { success: true } : { card },
        });
      if (url.pathname === "/api/kanban/cards/gone")
        return route.fulfill({
          status: 404,
          json: { error: "Card not found" },
        });
      if (url.pathname === "/api/equipment")
        return route.fulfill({
          json: {
            equipment: [
              {
                id: "printer-2",
                name: "Printer 2",
                status: "available",
                documentation_url: "https://docs.example/printer-sop",
              },
            ],
          },
        });
      if (url.pathname === "/api/users")
        return route.fulfill({
          json: [
            { onshape_user_id: "slack:TTEAM:UJORDAN", name: "Jordan Lee" },
            { onshape_user_id: viewer, name: "Sam Park" },
          ],
        });
      if (url.pathname === "/api/onshape/thumbnail")
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
        });
      return route.fulfill({ json: {} });
    });
    await page.route(
      (url) =>
        url.host === "localhost:32200" && !url.pathname.startsWith("/api/"),
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<div id="root"></div>',
        })
    );
    async function show(cardId: string) {
      requests = [];
      await page.goto("http://localhost:32200/parts/" + cardId);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      await page.evaluate(
        ([cardId, viewer]) => (window as any).show(cardId, viewer),
        [cardId, viewer]
      );
    }

    await show("bracket");
    await page
      .getByRole("heading", { name: "Button Head 4x Size", level: 1 })
      .waitFor();
    await page
      .getByText("Miscellaneous · v4 · released by Jordan Lee")
      .waitFor();

    const status = page.getByRole("list", { name: "Status" });
    assert.deepEqual(await status.getByRole("listitem").allTextContents(), [
      "Backlog",
      "In progress",
      "Review",
      "Done",
    ]);
    assert.equal(
      await status.locator('[aria-current="step"]').textContent(),
      "In progress"
    );

    const fact = (name: string) =>
      page
        .getByRole("definition")
        .and(page.locator(`[data-fact="${name}"]`))
        .textContent();
    assert.equal(await fact("Quantity"), "2");
    assert.equal(await fact("Material"), "PLA");
    assert.equal(await fact("Machine"), "Printer 2");
    assert.equal(await fact("Process"), "3D Printing");
    assert.equal(await fact("Made by"), "You");
    assert.equal(await fact("Due"), "Fri, Nov 20");

    const notes = page.getByRole("region", { name: "Notes from Jordan Lee" });
    await notes.getByText("Check the hex socket").waitFor();
    const warnings = page.getByRole("region", { name: "Release warnings" });
    await warnings.getByText("This part has no description.").waitFor();
    await warnings.getByText("Add one in Onshape.").waitFor();

    assert.equal(
      await page
        .getByRole("link", { name: /Printer 2 SOP/ })
        .getAttribute("href"),
      "https://docs.example/printer-sop"
    );
    assert.equal(
      await page
        .getByRole("link", { name: /Open in Onshape/ })
        .getAttribute("href"),
      "https://cad.onshape.com/documents/doc/v/version/e/studio"
    );

    // History stays behind its row until tapped.
    const history = page.getByRole("button", { name: /History/ });
    await history.getByText("2 changes").waitFor();
    assert.equal(
      await page.getByRole("region", { name: "Status history" }).count(),
      0
    );
    await history.click();
    const historyList = page.getByRole("region", { name: "Status history" });
    await historyList.getByText("Released into Backlog").waitFor();
    await historyList.getByText("Backlog → In Progress").waitFor();

    // A small picture that opens large.
    const thumb = page.getByRole("button", { name: "Enlarge picture" });
    const small = await thumb.boundingBox();
    assert.ok(small && small.width <= 96 && small.height <= 96);
    await thumb.click();
    const enlarged = page
      .getByRole("dialog", { name: "Button Head 4x Size" })
      .getByRole("img");
    await enlarged.waitFor();
    const large = await enlarged.boundingBox();
    assert.ok(large && large.width > 300);
    await page.keyboard.press("Escape");

    // Delete only from the overflow menu, and only after confirming.
    assert.equal(
      await page.getByRole("button", { name: /delete/i }).count(),
      0
    );
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete part" }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm
      .getByText(/permanently delete "Button Head 4x Size"/)
      .waitFor();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    assert.ok(!requests.includes("DELETE /api/kanban/cards/bracket"));
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete part" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page.waitForURL("http://localhost:32200/next");
    assert.ok(requests.includes("DELETE /api/kanban/cards/bracket"));

    await show("gone");
    await page.getByRole("heading", { name: "Part not found" }).waitFor();
  } finally {
    await browser.close();
  }
});
