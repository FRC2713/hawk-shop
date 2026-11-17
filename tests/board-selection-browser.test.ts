import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import {
  boardCard,
  boardCardFace,
  boardEquipment,
  boardProcesses,
  openBoard,
  type OpenBoardOptions,
} from "./board-browser-fixture";

const PORT = 32215;
const MILLING = { id: "milling", name: "CNC Milling" };
const PRINTING = { id: "printing", name: "3D Printing" };

// Backlog reads Bracket, Plate, Spacer, Gusset top to bottom (relevance ties
// keep the order given).
const cards = [
  boardCard("Bracket", { processes: [MILLING] }),
  boardCard("Plate", { processes: [PRINTING] }),
  boardCard("Spacer", { processes: [PRINTING] }),
  boardCard("Gusset"),
  boardCard("Axle", { column_id: "in-progress", processes: [PRINTING] }),
  boardCard("Hub", { column_id: "in-progress" }),
];

const equipment = [
  ...boardEquipment,
  {
    id: "lathe",
    name: "Lathe",
    status: "maintenance",
    processes: [boardProcesses[0]],
    machine_status: "needs-maintenance",
    queue_size: 0,
    current_parts: [],
  },
];

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

function open(answer?: OpenBoardOptions["answer"]) {
  return openBoard(browser, { port: PORT, cards, equipment, answer });
}

const checkbox = (page: Page, title: string) =>
  page.getByRole("checkbox", { name: `Select ${title}` });
const actionBar = (page: Page) =>
  page.getByRole("toolbar", { name: "Selected cards" });

async function expectSelected(page: Page, selected: string[]) {
  for (const { title } of cards) {
    const box = checkbox(page, title);
    if (selected.includes(title)) await expect(box).toBeChecked();
    else await expect(box).not.toBeChecked();
  }
  if (selected.length)
    await expect(actionBar(page)).toContainText(`${selected.length} selected`);
  else await expect(actionBar(page)).toHaveCount(0);
}

test("a plain click opens details; checkboxes, cmd-click and shift-click select within one column", async () => {
  const { page } = await open();
  try {
    await boardCardFace(page, "Plate").click();
    await expect(page.getByRole("dialog", { name: "Plate" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectSelected(page, []);

    await checkbox(page, "Bracket").click();
    await expectSelected(page, ["Bracket"]);

    // Shift-click on a card face selects the range and opens nothing.
    await boardCardFace(page, "Spacer").click({ modifiers: ["Shift"] });
    await expectSelected(page, ["Bracket", "Plate", "Spacer"]);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Cmd/ctrl-click toggles one card.
    await boardCardFace(page, "Plate").click({ modifiers: ["ControlOrMeta"] });
    await expectSelected(page, ["Bracket", "Spacer"]);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Shift on a checkbox ranges from the last card clicked.
    await checkbox(page, "Gusset").click({ modifiers: ["Shift"] });
    await expectSelected(page, ["Bracket", "Plate", "Spacer", "Gusset"]);

    // Another column starts a new selection there.
    await checkbox(page, "Hub").click();
    await expectSelected(page, ["Hub"]);
    await boardCardFace(page, "Axle").click({ modifiers: ["Shift"] });
    await expectSelected(page, ["Axle", "Hub"]);

    await actionBar(page).getByRole("button", { name: "Clear" }).click();
    await expectSelected(page, []);
  } finally {
    await page.close();
  }
});

/** A multipart moveCard post as `cardId->columnId`. */
function moveOf(body: string) {
  const field = (name: string) =>
    body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1];
  return `${field("cardId")}->${field("columnId")}`;
}

test("Move to moves every selected card and names the ones that didn't move", async () => {
  const moves: string[] = [];
  const { page } = await open((request, path) => {
    if (path !== "/api/mfg/parts/actions") return undefined;
    const move = moveOf(request.postData() ?? "");
    moves.push(move);
    return move.startsWith("Plate")
      ? { status: 400, json: { success: false, error: "Card is locked" } }
      : { json: { success: true } };
  });
  try {
    await checkbox(page, "Bracket").click();
    await checkbox(page, "Spacer").click({ modifiers: ["Shift"] });
    await actionBar(page).getByRole("combobox", { name: "Move to" }).click();
    // The cards' own column isn't offered.
    await expect(page.getByRole("option", { name: "Backlog" })).toHaveCount(0);
    await page.getByRole("option", { name: "Review" }).click();

    await expect(page.getByText("1 of 3 cards didn't change")).toBeVisible();
    await expect(page.getByText("Moved 2 cards to Review.")).toBeVisible();
    await expect(page.getByText("Plate: Card is locked")).toBeVisible();
    assert.deepEqual(moves.sort(), [
      "Bracket->review",
      "Plate->review",
      "Spacer->review",
    ]);
    // The card that didn't move stays selected for another try.
    await expect(actionBar(page)).toContainText("1 selected");
    await expect(checkbox(page, "Plate")).toBeChecked();
  } finally {
    await page.close();
  }
});

test("Assign machine offers eligible machines, sends the Backlog cards it can take and names the rest", async () => {
  const sent: unknown[] = [];
  const { page } = await open((request, path) => {
    if (path !== "/api/kanban/cards/assign-machine") return undefined;
    sent.push(request.postDataJSON());
    return { json: { cards: [] } };
  });
  try {
    await checkbox(page, "Bracket").click();
    await checkbox(page, "Spacer").click({ modifiers: ["Shift"] });
    await actionBar(page)
      .getByRole("button", { name: "Assign machine" })
      .click();
    // Lathe is under maintenance; Router and Printer 2 each take a card.
    const offered = page.getByRole("menuitem");
    await expect(offered).toHaveText([/Printer 2/, /Router/, "No machine"]);
    await page.getByRole("menuitem", { name: /Printer 2/ }).click();

    await expect(page.getByText("1 of 3 cards didn't change")).toBeVisible();
    await expect(
      page.getByText("Assigned 2 cards to Printer 2.")
    ).toBeVisible();
    await expect(
      page.getByText("Bracket: Printer 2 doesn't do CNC Milling")
    ).toBeVisible();
    assert.deepEqual(sent, [
      { cardIds: ["Plate", "Spacer"], machineId: "printer" },
    ]);
  } finally {
    await page.close();
  }
});

test("Assign machine lists the cards the server refused", async () => {
  const { page } = await open((_request, path) =>
    path === "/api/kanban/cards/assign-machine"
      ? {
          status: 409,
          json: {
            error: "Printer 2 is busy",
            code: "machine_needs_maintenance",
            cardIds: ["Spacer"],
          },
        }
      : undefined
  );
  try {
    await checkbox(page, "Plate").click();
    await checkbox(page, "Spacer").click({ modifiers: ["Shift"] });
    await actionBar(page)
      .getByRole("button", { name: "Assign machine" })
      .click();
    await page.getByRole("menuitem", { name: /Printer 2/ }).click();

    await expect(page.getByText("2 of 2 cards didn't change")).toBeVisible();
    await expect(page.getByText("Spacer: Printer 2 is busy")).toBeVisible();
    await expect(
      page.getByText("Plate: not changed, another card was refused")
    ).toBeVisible();
    await expect(actionBar(page)).toContainText("2 selected");
  } finally {
    await page.close();
  }
});

test("Assign machine explains that only Backlog cards take a machine", async () => {
  const { page, stub } = await open();
  try {
    await checkbox(page, "Axle").click();
    await actionBar(page)
      .getByRole("button", { name: "Assign machine" })
      .click();
    await expect(
      page.getByText("Only Backlog cards can take a machine.")
    ).toBeVisible();
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    assert.ok(!stub.requests.some((r) => r.startsWith("POST")));
  } finally {
    await page.close();
  }
});

test("Change project updates each selected card and names the ones that failed", async () => {
  const patches: string[] = [];
  const { page } = await open((request, path) => {
    if (request.method() !== "PATCH") return undefined;
    const id = decodeURIComponent(path.split("/")[4]);
    patches.push(`${id}:${request.postDataJSON().project_id}`);
    return id === "Gusset"
      ? { status: 409, json: { error: "That project is archived" } }
      : { json: { card: {} } };
  });
  try {
    await checkbox(page, "Spacer").click();
    await checkbox(page, "Gusset").click({ modifiers: ["Shift"] });
    await actionBar(page)
      .getByRole("combobox", { name: "Change project" })
      .click();
    await page.getByRole("option", { name: "Intake" }).click();

    await expect(page.getByText("1 of 2 cards didn't change")).toBeVisible();
    await expect(page.getByText("Moved 1 card to Intake.")).toBeVisible();
    await expect(
      page.getByText("Gusset: That project is archived")
    ).toBeVisible();
    assert.deepEqual(patches.sort(), ["Gusset:intake", "Spacer:intake"]);
  } finally {
    await page.close();
  }
});

test("dragging a selected card moves the whole selection through moveCard", async () => {
  const moves: string[] = [];
  const { page } = await open((request, path) => {
    if (path !== "/api/mfg/parts/actions") return undefined;
    moves.push(moveOf(request.postData() ?? ""));
    return { json: { success: true } };
  });
  try {
    await checkbox(page, "Bracket").click();
    await checkbox(page, "Plate").click();
    const from = await boardCardFace(page, "Plate").boundingBox();
    const to = await page.getByRole("region", { name: "Review" }).boundingBox();
    assert.ok(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + 150, { steps: 12 });
    await page.mouse.up();

    await expect
      .poll(() => moves.sort())
      .toEqual(["Bracket->review", "Plate->review"]);
    // A drag isn't a click: no details opened.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await page.close();
  }
});
