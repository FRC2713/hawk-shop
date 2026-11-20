import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { chromium, expect, type Browser, type Page } from "@playwright/test";

const PORT = 32210;
const viewer = "slack:TTEAM:USAM";
const jordan = "slack:TTEAM:UJORDAN";

type Card = {
  id: string;
  column_id: string;
  assignee: string | null;
  review_notes: { id: number; text: string; author_name: string }[];
};

function fixture(id: string, column_id: string, assignee: string | null) {
  return {
    id,
    column_id,
    title: `Part ${id}`,
    image_url: null,
    assignee,
    created_by: jordan,
    date_created: "2026-11-12T15:00:00.000Z",
    date_updated: "2026-11-13T15:00:00.000Z",
    machine: null,
    machine_id: "printer-2",
    queue_position: null,
    due_date: null,
    content: null,
    release_issues: [],
    quantity_to_make: 1,
    onshape_material: "PLA",
    onshape_version_name: "v1",
    project_id: null,
    project: null,
    processes: [{ id: "process-3d-printing", name: "3D Printing" }],
    linked_machine: { id: "printer-2", name: "Printer 2", status: "available" },
    review_notes: [] as Card["review_notes"],
    status_history: [],
  };
}

/** The stubbed server: cards by id, and the workflow moves they accept. */
let cards: Record<string, ReturnType<typeof fixture>> = {};
let requests: { call: string; body: unknown }[] = [];
/** When set, the next claim of this card loses to Jordan. */
let claimedByJordan: string | null = null;
let browser: Browser;
let page: Page;
let bundleText: string;

before(async () => {
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
    import { KanbanRealtimeSubscriber } from './src/components/kanban/KanbanRealtimeSubscriber';
    window.show = (cardId, viewerId) => {
      const client = new QueryClient({ defaultOptions: {queries: {retry: false}} });
      createRoot(document.getElementById('root')).render(
        <QueryClientProvider client={client}>
          <KanbanRealtimeSubscriber />
          <PartPage cardId={cardId} viewerId={viewerId} />
        </QueryClientProvider>);
    };
  `,
    },
  });
  bundleText = bundle.outputFiles[0].text;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(4000);
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ? JSON.parse(request.postData()!) : null;
    requests.push({ call: `${request.method()} ${path}`, body });
    if (path === "/api/kanban/events")
      // Every (re)connection reports a change, so the page refetches
      // whatever the stub now says.
      return route.fulfill({
        contentType: "text/event-stream",
        body: "retry: 200\nevent: change\ndata: {}\n\n",
      });
    if (path === "/api/users")
      return route.fulfill({
        json: [
          { onshape_user_id: jordan, name: "Jordan Lee" },
          { onshape_user_id: viewer, name: "Sam Park" },
        ],
      });
    if (path === "/api/equipment")
      return route.fulfill({
        json: { equipment: [{ id: "printer-2", name: "Printer 2" }] },
      });
    const match = path.match(/^\/api\/kanban\/cards\/([^/]+)(?:\/([a-z-]+))?$/);
    const card = match && cards[match[1]];
    if (!card) return route.fulfill({ json: {} });
    const action = match[2];
    if (!action) return route.fulfill({ json: { card } });
    const move = (column_id: string, assignee = card.assignee) => {
      card.column_id = column_id;
      card.assignee = assignee;
      return route.fulfill({ json: { card } });
    };
    if (action === "claim") {
      if (claimedByJordan === card.id) {
        card.column_id = "in-progress";
        card.assignee = jordan;
        return route.fulfill({
          status: 409,
          json: {
            error: "Someone else already claimed this part",
            code: "already_claimed",
            cardIds: [card.id],
          },
        });
      }
      return move("in-progress", viewer);
    }
    if (action === "unclaim") return move("backlog", null);
    if (action === "done") return move("review");
    if (action === "approve") return move("done");
    if (action === "send-back") {
      card.review_notes.push({
        id: card.review_notes.length + 1,
        text: (body as { reason: string }).reason,
        author_name: "Sam Park",
      });
      return move(card.assignee ? "in-progress" : "backlog");
    }
    return route.fulfill({ status: 404, json: { error: "Not found" } });
  });
  await page.route(
    (url) =>
      url.host === `localhost:${PORT}` && !url.pathname.startsWith("/api/"),
    (route) =>
      route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' })
  );
});

after(async () => {
  await browser?.close();
});

async function show(card: ReturnType<typeof fixture>, search = "") {
  cards = { [card.id]: card };
  requests = [];
  await page.goto(`http://localhost:${PORT}/parts/${card.id}${search}`);
  await page.addScriptTag({ content: bundleText });
  await page.evaluate(
    ([cardId, viewer]) => (window as any).show(cardId, viewer),
    [card.id, viewer]
  );
  await page.getByRole("heading", { name: `Part ${card.id}` }).waitFor();
}

const bar = () => page.getByRole("contentinfo", { name: "Part actions" });
const actions = () => bar().getByRole("button").allTextContents();
const posted = (id: string, action: string) =>
  requests.filter((r) => r.call === `POST /api/kanban/cards/${id}/${action}`);

test("a Backlog part offers Claim, which claims it for you", async () => {
  await show(fixture("bracket", "backlog", null));
  assert.deepEqual(await actions(), ["Claim"]);
  await bar().getByRole("button", { name: "Claim" }).click();
  await page.locator('[data-fact="Made by"]', { hasText: "You" }).waitFor();
  assert.equal(posted("bracket", "claim").length, 1);
});

test("an In Progress part offers Unclaim and Done", async () => {
  await show(fixture("plate", "in-progress", viewer));
  assert.deepEqual(await actions(), ["Unclaim", "Done, send to review"]);
  await bar().getByRole("button", { name: "Done, send to review" }).click();
  await page
    .getByRole("list", { name: "Status" })
    .locator('[aria-current="step"]', { hasText: "Review" })
    .waitFor();
  assert.equal(posted("plate", "done").length, 1);

  await show(fixture("plate", "in-progress", viewer));
  await bar().getByRole("button", { name: "Unclaim" }).click();
  await bar().getByRole("button", { name: "Claim" }).waitFor();
  assert.equal(posted("plate", "unclaim").length, 1);
});

test("a Review part offers Approve, and Send back won't go without a reason", async () => {
  await show(fixture("gusset", "review", viewer));
  assert.deepEqual(await actions(), ["Send back", "Approve"]);

  await bar().getByRole("button", { name: "Send back" }).click();
  const dialog = page.getByRole("dialog", { name: "Send this part back?" });
  const reason = dialog.getByRole("textbox", { name: "Reason" });
  const submit = dialog.getByRole("button", { name: "Send back" });
  assert.ok(await submit.isDisabled());
  await reason.fill("   ");
  assert.ok(await submit.isDisabled());
  await reason.fill("Holes are undersized");
  await submit.click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(
    posted("gusset", "send-back").map((r) => r.body),
    [{ reason: "Holes are undersized" }]
  );
  await page
    .getByRole("region", { name: "Sent back" })
    .getByText("Holes are undersized")
    .waitFor();
  await bar().getByRole("button", { name: "Done, send to review" }).waitFor();

  await show(fixture("gusset", "review", viewer));
  await bar().getByRole("button", { name: "Approve" }).click();
  await page
    .getByRole("list", { name: "Status" })
    .locator('[aria-current="step"]', { hasText: "Done" })
    .waitFor();
  assert.equal(posted("gusset", "approve").length, 1);
  // A Done part keeps the bar as a read-only line, with no buttons.
  await bar().getByText("Done", { exact: true }).waitFor();
  assert.equal(await bar().getByRole("button").count(), 0);
});

test("the bar follows the part when someone else acts on it", async () => {
  const card = fixture("bushing", "backlog", null);
  await show(card);
  await bar().getByRole("button", { name: "Claim" }).waitFor();
  // Jordan claims it from another phone; the event stream reports a change.
  card.column_id = "in-progress";
  card.assignee = jordan;
  await bar().getByRole("button", { name: "Done, send to review" }).waitFor();
  await page
    .locator('[data-fact="Made by"]', { hasText: "Jordan Lee" })
    .waitFor();
  assert.equal(posted("bushing", "claim").length, 0);
});

test("losing a claim says who got it and refreshes the part", async () => {
  await show(fixture("spacer", "backlog", null));
  claimedByJordan = "spacer";
  try {
    const before = requests.filter(
      (r) => r.call === "GET /api/kanban/cards/spacer"
    ).length;
    await bar().getByRole("button", { name: "Claim" }).click();
    await bar()
      .getByRole("alert")
      .getByText("Jordan Lee already claimed this part")
      .waitFor();
    await page
      .locator('[data-fact="Made by"]', { hasText: "Jordan Lee" })
      .waitFor();
    assert.ok(
      requests.filter((r) => r.call === "GET /api/kanban/cards/spacer").length >
        before
    );
  } finally {
    claimedByJordan = null;
  }
});

test("station intent highlights Claim and sends the machine only after an explicit tap", async () => {
  const card = fixture("qr-bracket", "backlog", null);
  await show(card, "?intent=claim&machineId=printer-2");
  await expect(bar().getByRole("status")).toContainText("Claim at Printer 2");
  await expect(
    bar().getByRole("button", { name: "Claim", exact: true })
  ).toHaveAttribute("aria-describedby", "station-claim-intent");
  assert.equal(posted(card.id, "claim").length, 0);
  await bar().getByRole("button", { name: "Claim", exact: true }).click();
  await expect(bar()).toContainText("already moved out of Backlog");
  assert.deepEqual(
    posted(card.id, "claim").map((r) => r.body),
    [{ machineId: "printer-2" }]
  );
});

test("invalid station context requires recovery instead of silently claiming without a machine", async () => {
  for (const search of [
    "?intent=claim",
    "?intent=claim&machineId=deleted",
    "?intent=claim&machineId=printer-2&machineId=deleted",
  ]) {
    const card = fixture("invalid-qr", "backlog", null);
    await show(card, search);
    await expect(bar().getByRole("status")).toContainText(
      "no available machine"
    );
    await expect(
      bar().getByRole("button", { name: "Claim", exact: true })
    ).toBeDisabled();
    await expect(
      bar().getByRole("link", { name: "Open part without station claim" })
    ).toHaveAttribute("href", "/parts/invalid-qr");
    assert.equal(posted(card.id, "claim").length, 0);
  }
});

test("a stale QR on a finished part explains its current status and never claims", async () => {
  const card = fixture("done-qr", "done", jordan);
  await show(card, "?intent=claim&machineId=printer-2");
  await expect(bar().getByRole("status")).toContainText(
    "already moved out of Backlog"
  );
  await expect(
    bar().getByRole("button", { name: "Claim", exact: true })
  ).toHaveCount(0);
  assert.equal(posted(card.id, "claim").length, 0);
});

test("station claim conflicts keep the server reason and let the member recover", async () => {
  await show(
    fixture("conflict-qr", "backlog", null),
    "?intent=claim&machineId=printer-2"
  );
  await page.route("**/conflict-qr/claim", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "This machine needs maintenance" },
    })
  );
  try {
    const postedClaim = page.waitForRequest((r) =>
      r.url().endsWith("/conflict-qr/claim")
    );
    await bar().getByRole("button", { name: "Claim", exact: true }).click();
    await expect(bar().getByRole("alert")).toContainText(
      "This machine needs maintenance"
    );
    assert.deepEqual((await postedClaim).postDataJSON(), {
      machineId: "printer-2",
    });
    await expect(
      bar().getByRole("link", { name: "Open part without station claim" })
    ).toBeVisible();
  } finally {
    await page.unroute("**/conflict-qr/claim");
  }
});

test("phone actions handle assigned Backlog and unassigned In Progress like desktop", async () => {
  await show(fixture("preassigned", "backlog", viewer));
  await expect(
    bar().getByRole("button", { name: "Unclaim", exact: true })
  ).toBeVisible();
  await expect(
    bar().getByRole("button", { name: "Claim", exact: true })
  ).toHaveCount(0);
  await show(fixture("unassigned-progress", "in-progress", null));
  await expect(
    bar().getByRole("button", { name: "Claim", exact: true })
  ).toBeVisible();
  await expect(
    bar().getByRole("button", { name: "Unclaim", exact: true })
  ).toHaveCount(0);
  await bar().getByRole("button", { name: "Claim", exact: true }).click();
  await expect(
    bar().getByRole("button", { name: "Unclaim", exact: true })
  ).toBeVisible();
});
