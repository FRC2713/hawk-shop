import { test } from "node:test";
import { chromium, expect } from "@playwright/test";
import {
  ago,
  boardCard,
  boardCardFace,
  launchBoardBrowser,
  openBoard,
  PRINTING,
} from "./board-browser-fixture";

const PORT = 32212;
const users = [
  { onshape_user_id: "sam", name: "Sam" },
  { onshape_user_id: "alex", name: "Alex" },
];

test("compact cards show quantity, material, machine, assignee and time in status", async () => {
  const { browser, page } = await launchBoardBrowser(chromium);
  try {
    await openBoard(page, {
      port: PORT,
      users,
      cards: [
        boardCard("Socket Cap Head", {
          column_id: "in-progress",
          quantity_to_make: 2,
          onshape_material: "PLA",
          assignee: "sam",
          machine_id: "printer-2",
          linked_machine: { id: "printer-2", name: "Printer 2", status: null },
          processes: [PRINTING],
          date_updated: ago(5),
          project: { id: "drive", name: "Drivetrain", archived_at: null },
        }),
        boardCard("Torx drive", {
          quantity_to_make: 4,
          onshape_material: "PETG",
          processes: [PRINTING],
          date_updated: ago(26),
        }),
      ],
    });

    const socket = boardCardFace(page, "Socket Cap Head");
    await expect(socket).toContainText("×2");
    await expect(socket).toContainText("PLA · Printer 2 · Sam · 5 h");
    // Tags every card carried are gone from the face.
    await expect(socket).not.toContainText("Drivetrain");
    await expect(socket).not.toContainText("3D Printing");
    await expect(socket.locator("img")).toBeVisible();

    const torx = boardCardFace(page, "Torx drive");
    await expect(torx).toContainText("×4");
    await expect(torx).toContainText("PETG · any 3D Printing · 26 h");

    await expect(
      page
        .getByRole("region", { name: "In Progress" })
        .getByLabel("Matching cards")
    ).toHaveText("1");
  } finally {
    await browser.close();
  }
});

test("flags appear only for warnings, recent send-backs and a day waiting in Review", async () => {
  const { browser, page } = await launchBoardBrowser(chromium);
  const note = (hours: number) => ({
    id: `note-${hours}`,
    author_name: "Alex",
    text: "Wrong hole size",
    created_at: ago(hours),
  });
  try {
    await openBoard(page, {
      port: PORT,
      users,
      cards: [
        boardCard("Clean part", { machine: "TBD" }),
        boardCard("Sorting grid", {
          release_issues: [{ code: "no-material", message: "No material" }],
        }),
        boardCard("Gearbox plate", {
          column_id: "in-progress",
          review_notes: [note(30)],
        }),
        boardCard("Old send-back", {
          column_id: "in-progress",
          review_notes: [note(24 * 8)],
        }),
        boardCard("Cable guide", {
          column_id: "review",
          date_updated: ago(26),
        }),
        boardCard("Fresh review", {
          column_id: "review",
          date_updated: ago(3),
        }),
      ],
    });

    const flagless = ["Clean part", "Old send-back", "Fresh review"];
    for (const title of flagless) {
      await expect(boardCardFace(page, title)).toBeVisible();
      await expect(boardCardFace(page, title)).not.toContainText(
        /warning|Sent back|Over a day|TBD|Miscellaneous/
      );
    }
    await expect(boardCardFace(page, "Sorting grid")).toContainText(
      "1 warning"
    );
    await expect(boardCardFace(page, "Gearbox plate")).toContainText(
      "Sent back once"
    );
    await expect(boardCardFace(page, "Cable guide")).toContainText(
      "Over a day in review"
    );
  } finally {
    await browser.close();
  }
});

test("the Compact/Pictures choice is remembered in the browser", async () => {
  const { browser, page } = await launchBoardBrowser(chromium);
  try {
    const data = { port: PORT, users, cards: [boardCard("Bellypan")] };
    await openBoard(page, data);
    const density = page.getByRole("group", { name: "Density" });
    const bellypan = boardCardFace(page, "Bellypan");
    await expect(
      density.getByRole("button", { name: "Compact" })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(bellypan.getByRole("img", { name: "Bellypan" })).toHaveCount(
      0
    );

    await density.getByRole("button", { name: "Pictures" }).click();
    await expect(bellypan.getByRole("img", { name: "Bellypan" })).toBeVisible();
    await expect(
      (await bellypan.getByRole("img", { name: "Bellypan" }).boundingBox())
        ?.height
    ).toBe(120);

    await openBoard(page, data);
    await expect(
      density.getByRole("button", { name: "Pictures" })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(bellypan.getByRole("img", { name: "Bellypan" })).toBeVisible();

    await density.getByRole("button", { name: "Compact" }).click();
    await expect(bellypan.getByRole("img", { name: "Bellypan" })).toHaveCount(
      0
    );
  } finally {
    await browser.close();
  }
});
