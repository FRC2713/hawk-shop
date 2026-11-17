import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium, expect, type Page } from "@playwright/test";
import {
  boardCard,
  boardProjects,
  bundleBoard,
  openBoard,
} from "./board-browser-fixture";

const PORT = 32211;

const cards = [
  boardCard({
    id: "bracket",
    title: "Bracket",
    created_by: "alice",
    machine_id: "router",
    linked_machine: { id: "router", name: "Router", status: "active" },
    processes: [{ id: "milling", name: "CNC Milling" }],
  }),
  boardCard({
    id: "plate",
    title: "Plate",
    created_by: "bob",
    project_id: "intake",
    project: boardProjects[1],
    processes: [{ id: "printing", name: "3D Printing" }],
    release_issues: [
      { code: "missing-description", message: "No description." },
    ],
  }),
  boardCard({
    id: "spacer",
    title: "Spacer",
    created_by: "bob",
    machine_id: "printer",
    linked_machine: { id: "printer", name: "Printer 2", status: "active" },
    processes: [{ id: "printing", name: "3D Printing" }],
  }),
];

async function expectShown(page: Page, shown: string[]) {
  for (const { title } of cards) {
    const card = page.getByText(title, { exact: true });
    if (shown.includes(title)) await expect(card).toBeVisible();
    else await expect(card).toHaveCount(0);
  }
}

const params = (page: Page) => new URL(page.url()).searchParams;

async function pick(page: Page, button: RegExp, item: string) {
  await page.getByRole("button", { name: button }).click();
  await page.getByRole("menuitemcheckbox", { name: item, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function clearMenu(page: Page, button: RegExp) {
  await page.getByRole("button", { name: button }).click();
  await page.getByRole("menuitem", { name: "Show all", exact: true }).click();
}

test("board filters sit in one labelled row, each narrows the board and is kept in the URL", async () => {
  const script = await bundleBoard();
  const browser = await chromium.launch();
  try {
    const { page } = await openBoard(browser, {
      port: PORT,
      script,
      cards,
      search: "?keep=yes",
    });
    const bar = page.getByRole("search", { name: "Board filters" });
    const search = bar.getByRole("searchbox", { name: "Search parts" });
    const controls = [
      search,
      bar.getByRole("button", { name: "Project: All" }),
      bar.getByRole("button", { name: "Process: All" }),
      bar.getByRole("button", { name: "Machine: All" }),
      bar.getByRole("button", { name: "Released by: All" }),
      bar.getByRole("button", { name: "Has warnings", exact: true }),
      bar.getByRole("combobox", { name: "Sort" }),
    ];
    for (const control of controls) await expect(control).toBeVisible();
    await expect(search).toHaveAttribute("placeholder", /Search parts/);
    // One row at desktop width, in the order above.
    const boxes = await Promise.all(controls.map((c) => c.boundingBox()));
    const lefts = boxes.map((box) => box!.x);
    assert.deepEqual(
      [...lefts].sort((a, b) => a - b),
      lefts
    );
    const middles = boxes.map((box) => box!.y + box!.height / 2);
    for (const middle of middles)
      assert.ok(Math.abs(middle - middles[0]) < 4, `${middles}`);
    await expectShown(page, ["Bracket", "Plate", "Spacer"]);

    // Search
    await search.fill("spacer");
    await expectShown(page, ["Spacer"]);
    assert.equal(params(page).get("q"), "spacer");
    await search.fill("");
    await expectShown(page, ["Bracket", "Plate", "Spacer"]);
    assert.equal(params(page).has("q"), false);

    // Project
    await pick(page, /^Project:/, "Drivetrain");
    await expect(
      bar.getByRole("button", { name: "Project: Drivetrain" })
    ).toBeVisible();
    await expectShown(page, ["Bracket", "Spacer"]);
    assert.deepEqual(params(page).getAll("project"), ["drivetrain"]);
    await clearMenu(page, /^Project:/);
    assert.equal(params(page).has("project"), false);

    // Process
    await pick(page, /^Process:/, "3D Printing");
    await expectShown(page, ["Plate", "Spacer"]);
    assert.deepEqual(params(page).getAll("process"), ["printing"]);
    await clearMenu(page, /^Process:/);

    // Machine, including cards with none
    await pick(page, /^Machine:/, "Router");
    await expectShown(page, ["Bracket"]);
    await pick(page, /^Machine:/, "No machine");
    await expect(
      bar.getByRole("button", { name: "Machine: 2 selected" })
    ).toBeVisible();
    await expectShown(page, ["Bracket", "Plate"]);
    assert.deepEqual(params(page).getAll("machine"), ["router", "none"]);
    await clearMenu(page, /^Machine:/);

    // Submitter
    await pick(page, /^Released by:/, "Bob Ruiz");
    await expectShown(page, ["Plate", "Spacer"]);
    assert.deepEqual(params(page).getAll("submitter"), ["bob"]);
    await clearMenu(page, /^Released by:/);

    // Has warnings
    const warnings = bar.getByRole("button", {
      name: "Has warnings",
      exact: true,
    });
    await warnings.click();
    await expect(warnings).toHaveAttribute("aria-pressed", "true");
    await expectShown(page, ["Plate"]);
    assert.equal(params(page).get("warnings"), "1");
    await warnings.click();
    await expectShown(page, ["Bracket", "Plate", "Spacer"]);

    // Sort
    await bar.getByRole("combobox", { name: "Sort" }).click();
    await page.getByRole("option", { name: "Project" }).click();
    assert.equal(params(page).get("sort"), "project");

    // Unrelated parameters survive every write.
    assert.equal(params(page).get("keep"), "yes");
  } finally {
    await browser.close();
  }
});

test("a filtered board URL restores every filter, survives reload and clears in one step", async () => {
  const script = await bundleBoard();
  const browser = await chromium.launch();
  try {
    const { page, reload } = await openBoard(browser, {
      port: PORT,
      script,
      cards,
      search:
        "?q=p&project=drivetrain&project=intake&process=printing&machine=none&machine=printer&submitter=bob&sort=user",
    });
    const bar = page.getByRole("search", { name: "Board filters" });
    const check = async () => {
      await expect(
        bar.getByRole("searchbox", { name: "Search parts" })
      ).toHaveValue("p");
      await expect(
        bar.getByRole("button", { name: "Project: 2 selected" })
      ).toBeVisible();
      await expect(
        bar.getByRole("button", { name: "Process: 3D Printing" })
      ).toBeVisible();
      await expect(
        bar.getByRole("button", { name: "Machine: 2 selected" })
      ).toBeVisible();
      await expect(
        bar.getByRole("button", { name: "Released by: Bob Ruiz" })
      ).toBeVisible();
      await expect(bar.getByRole("combobox", { name: "Sort" })).toHaveText(
        /Assignee/
      );
      await expectShown(page, ["Plate", "Spacer"]);
    };
    await check();
    await reload();
    await check();

    await page.goto(
      `http://localhost:${PORT}/kanban?warnings=1&process=milling`
    );
    await reload();
    await expect(
      bar.getByRole("button", { name: "Has warnings", exact: true })
    ).toHaveAttribute("aria-pressed", "true");
    await expectShown(page, []);

    await bar.getByRole("button", { name: "Clear filters" }).click();
    await expectShown(page, ["Bracket", "Plate", "Spacer"]);
    assert.equal(new URL(page.url()).search, "");
  } finally {
    await browser.close();
  }
});

test("the / key focuses board search unless typing elsewhere", async () => {
  const script = await bundleBoard();
  const browser = await chromium.launch();
  try {
    const { page } = await openBoard(browser, { port: PORT, script, cards });
    const search = page.getByRole("searchbox", { name: "Search parts" });
    await expect(search).toHaveAttribute("aria-keyshortcuts", "/");
    await expectShown(page, ["Bracket", "Plate", "Spacer"]);
    await page.keyboard.press("/");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await page.keyboard.type("/");
    await expect(search).toHaveValue("/");
  } finally {
    await browser.close();
  }
});
