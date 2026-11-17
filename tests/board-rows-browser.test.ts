import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect, type Page } from "@playwright/test";
import {
  ago,
  boardCard,
  boardCardFace,
  boardEquipment,
  boardProcesses,
  boardProjects,
  launchBoardBrowser,
  openBoard,
  PRINTING,
} from "./board-browser-fixture";

const PORT = 32213;

const MILLING = { id: "milling", name: "CNC Milling", icon: null, color: null };
const processes = [
  ...boardProcesses,
  { id: "sawing", name: "Sawing", description: null },
];
const equipment = [
  ...boardEquipment,
  {
    id: "printer-3",
    name: "Printer 3",
    status: "maintenance",
    processes: [boardProcesses[1]],
    machine_status: "needs-maintenance",
    queue_size: 0,
    current_parts: [],
  },
  {
    id: "printer-4",
    name: "Printer 4",
    status: "active",
    processes: [boardProcesses[1]],
    machine_status: "idle",
    queue_size: 0,
    current_parts: [],
  },
];
const intake = boardProjects[1];

const cards = [
  // On the router, so its row is milling even though printing comes first.
  boardCard("Gusset", {
    processes: [PRINTING, MILLING],
    machine_id: "router",
    linked_machine: { id: "router", name: "Router", status: null },
  }),
  boardCard("Spacer", { column_id: "in-progress", processes: [PRINTING] }),
  boardCard("Shaft", {
    column_id: "review",
    project_id: "intake",
    project: intake,
  }),
  boardCard("Old plate", {
    column_id: "done",
    processes: [MILLING],
    date_updated: ago(24 * 5),
  }),
];

const rowsControl = (page: Page) =>
  page.getByRole("group", { name: "View" }).getByRole("combobox", {
    name: "Rows",
  });
const row = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
const cell = (page: Page, rowName: string, column: string) =>
  row(page, rowName).getByRole("group", { name: column, exact: true });

async function chooseRows(page: Page, option: string) {
  await rowsControl(page).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("rows by process put each card in one process row under a machine summary, remembered per browser", async () => {
  const { browser, page } = await launchBoardBrowser(chromium);
  try {
    const { reload } = await openBoard(page, {
      port: PORT,
      cards,
      processes,
      equipment,
    });

    // No grouping until asked: plain status columns.
    await expect(rowsControl(page)).toHaveText(/None/);
    await expect(page.getByRole("region", { name: "Backlog" })).toBeVisible();

    await chooseRows(page, "Process");
    await expect(rowsControl(page)).toHaveText(/Process/);

    // Every process gets a row with its machines' summary; idle ones too.
    await expect(row(page, "Process CNC Milling")).toContainText("Router");
    await expect(row(page, "Process 3D Printing")).toContainText(
      "3 machines · 1 down"
    );
    await expect(row(page, "Process Sawing")).toContainText("No machines");

    // Assigned machine's process wins, else the first process, else none.
    await expect(
      boardCardFace(cell(page, "Process CNC Milling", "Backlog"), "Gusset")
    ).toBeVisible();
    await expect(
      boardCardFace(cell(page, "Process 3D Printing", "In Progress"), "Spacer")
    ).toBeVisible();
    await expect(
      boardCardFace(cell(page, "Process No process", "Review"), "Shaft")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Gusset" })).toHaveCount(1);

    // Done shows today's parts only, as without rows.
    await expect(page.getByText("Done today")).toBeVisible();
    await expect(boardCardFace(page, "Old plate")).toHaveCount(0);

    // Remembered by this browser, not the URL.
    assert.equal(new URL(page.url()).searchParams.get("group"), null);
    await reload();
    await expect(rowsControl(page)).toHaveText(/Process/);
    await expect(row(page, "Process Sawing")).toBeVisible();

    await chooseRows(page, "None");
    await expect(row(page, "Process Sawing")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Backlog" })).toBeVisible();
  } finally {
    await browser.close();
  }
});

test("rows by project show one row per project, and the old group=project link still opens them", async () => {
  const { browser, page } = await launchBoardBrowser(chromium);
  try {
    await openBoard(page, {
      port: PORT,
      cards,
      search: "?group=project",
    });
    await expect(rowsControl(page)).toHaveText(/Project/);
    await expect(
      boardCardFace(cell(page, "Project Drivetrain", "In Progress"), "Spacer")
    ).toBeVisible();
    await expect(
      boardCardFace(cell(page, "Project Intake", "Review"), "Shaft")
    ).toBeVisible();

    // Choosing again drops the old parameter; the browser remembers instead.
    await chooseRows(page, "Process");
    await chooseRows(page, "Project");
    await expect(row(page, "Project Intake")).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get("group"), null);
  } finally {
    await browser.close();
  }
});

test("an empty cell takes a drop, moving the card's status only", async () => {
  const { browser, page } = await launchBoardBrowser(chromium);
  try {
    const { stub } = await openBoard(page, {
      port: PORT,
      cards,
      processes,
      equipment,
    });
    await chooseRows(page, "Process");

    const target = cell(page, "Process Sawing", "Review");
    await expect(target).toBeVisible();
    const from = await boardCardFace(page, "Spacer").boundingBox();
    const to = await target.boundingBox();
    assert.ok(from && to);
    const moved = page.waitForRequest("**/api/mfg/parts/actions");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    const body = (await moved).postData() ?? "";
    assert.match(body, /moveCard/);
    assert.match(body, /\breview\b/);
    assert.ok(
      !stub.requests.some((request) => request.startsWith("PATCH ")),
      "A drop never edits processes or project"
    );
  } finally {
    await browser.close();
  }
});
