import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "hawk-slack-message-"));
process.env.APP_URL = "https://shop.example.org";
const { partBlocks, partMessageText, slackDueDate } =
  await import("../src/lib/slack/worker");

const row = { card_id: "card-1", title: "torx drive 4x" };
const details = {
  quantity_to_make: 2,
  payload: {
    project: "Intake",
    machine: "TBD",
    due_date: "2026-11-20",
    processes: ["3D Printing"],
    issues: [
      { severity: "warning", message: "This part has no description." },
      { severity: "error", message: "Material is missing." },
    ],
    onshape_url: "https://cad.onshape.com/documents/d/v/v1/e/e1",
  },
};

test("the release message reads as two summary lines without placeholders", () => {
  delete process.env.SLACK_SIGNING_SECRET;
  const blocks = partBlocks(row, details, "<@URACHEL>", null) as any[];
  assert.equal(blocks[0].type, "header");
  assert.equal(blocks[0].text.text, "torx drive 4x");
  assert.equal(
    blocks[1].text.text,
    "*Intake*  ·  released by <@URACHEL>  ·  due Fri, Nov 20\n*Make 2*  ·  3D Printing"
  );
  assert.ok(!JSON.stringify(blocks).includes("TBD"), "TBD machine is unset");
  assert.ok(!JSON.stringify(blocks).includes("Status"));
  assert.equal(
    blocks[2].elements[0].text,
    "⚠️ This part has no description.\n🛑 Material is missing."
  );
  assert.equal(blocks[3].type, "context", "text links without the secret");
  assert.match(blocks[3].elements[0].text, /\|Open in Hawk Shop>/);
  assert.match(blocks[3].elements[0].text, /\|Open in Onshape>/);
});

test("link buttons replace text links once the signing secret is set", () => {
  process.env.SLACK_SIGNING_SECRET = "fixture-secret";
  try {
    const blocks = partBlocks(row, details, "<@URACHEL>", null) as any[];
    const actions = blocks.at(-1);
    assert.equal(actions.type, "actions");
    assert.deepEqual(
      actions.elements.map((button: any) => [
        button.text.text,
        button.url,
        button.style,
      ]),
      [
        [
          "Open in Hawk Shop",
          "https://shop.example.org/kanban?cardId=card-1",
          "primary",
        ],
        [
          "Open in Onshape",
          "https://cad.onshape.com/documents/d/v/v1/e/e1",
          undefined,
        ],
      ]
    );
    const noOnshape = partBlocks(
      row,
      { ...details, payload: { ...details.payload, onshape_url: null } },
      "<@URACHEL>",
      null
    ) as any[];
    assert.equal(noOnshape.at(-1).elements.length, 1);
  } finally {
    delete process.env.SLACK_SIGNING_SECRET;
  }
});

test("the notification text names the project and quantity", () => {
  assert.equal(partMessageText(row, details), "Intake: torx drive 4x · make 2");
  assert.equal(
    partMessageText(row, {
      quantity_to_make: null,
      payload: { ...details.payload, project: undefined },
    }),
    "torx drive 4x"
  );
});

test("a real machine shows; an old snapshot's per-robot count does not", () => {
  // Snapshots taken before per-robot quantities were removed still carry one.
  const legacyPayload = {
    ...details.payload,
    quantity_per_robot: 1,
    machine: "Bambu X1",
    processes: [],
    issues: [],
    due_date: null,
  };
  const blocks = partBlocks(
    row,
    { quantity_to_make: null, payload: legacyPayload },
    "Rachel",
    null
  ) as any[];
  assert.equal(
    blocks[1].text.text,
    "*Intake*  ·  released by Rachel\nBambu X1"
  );
  assert.equal(blocks.length, 3, "no warnings block");
});

test("due dates are calendar days", () => {
  assert.equal(slackDueDate("2026-11-20T00:00:00.000Z"), "Fri, Nov 20");
  assert.equal(slackDueDate(null), null);
  assert.equal(slackDueDate("not a date"), null);
});
