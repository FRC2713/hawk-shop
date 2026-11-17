import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byMachineName,
  dueLabel,
  memberName,
  needsYouReason,
} from "../src/lib/phoneParts";

// Tuesday 17 Nov 2026, mid-afternoon local time.
const today = new Date(2026, 10, 17, 15, 0);

test("due dates read as a weekday within the next six days, otherwise as a date", () => {
  assert.deepEqual(dueLabel("2026-11-17", today), {
    text: "due today",
    overdue: false,
  });
  assert.deepEqual(dueLabel("2026-11-20", today), {
    text: "due Fri",
    overdue: false,
  });
  assert.deepEqual(dueLabel("2026-11-23", today), {
    text: "due Mon",
    overdue: false,
  });
  assert.deepEqual(dueLabel("2026-11-24", today), {
    text: "due Nov 24",
    overdue: false,
  });
  assert.deepEqual(dueLabel("2026-11-16", today), {
    text: "overdue, due Nov 16",
    overdue: true,
  });
});

test("machines sort by name with numbers in numeric order", () => {
  const names = ["Printer 10", "printer 2", "Chop Saw", "Printer 1"];
  assert.deepEqual(
    names
      .map((name) => ({ name }))
      .sort(byMachineName)
      .map(({ name }) => name),
    ["Chop Saw", "Printer 1", "printer 2", "Printer 10"]
  );
});

test("members are named from the user list, the viewer as You", () => {
  const users = [{ onshape_user_id: "slack:T:USAM", name: "Sam Park" }];
  assert.equal(memberName(users, "slack:T:USAM"), "Sam Park");
  assert.equal(memberName(users, "slack:T:USAM", "slack:T:USAM"), "You");
  assert.equal(memberName(users, "slack:T:UGONE"), "Someone");
  assert.equal(memberName(users, null), null);
});

function card(fields: Record<string, unknown>) {
  return {
    column_id: "in-progress",
    date_updated: "2026-11-16T10:00:00.000Z",
    release_issues: null,
    review_notes: [],
    ...fields,
  } as Parameters<typeof needsYouReason>[0];
}

const note = (created_at: string, text = "Hole pattern is off.") => ({
  id: 1,
  text,
  author_name: "Riley",
  created_at,
});

test("a sent-back part needs its designer until someone acts on it again", () => {
  // Sent back: the note is written with the move, so it is no older.
  assert.equal(
    needsYouReason(card({ review_notes: [note("2026-11-16T10:00:00.004Z")] })),
    "Sent back from review: Hole pattern is off."
  );
  // Unclaimed, then claimed again since: someone is remaking it.
  assert.equal(
    needsYouReason(
      card({
        date_updated: "2026-11-16T12:00:00.000Z",
        review_notes: [note("2026-11-16T10:00:00.004Z")],
      })
    ),
    null
  );
  assert.equal(
    needsYouReason(
      card({
        column_id: "backlog",
        date_updated: "2026-11-16T12:00:00.000Z",
        review_notes: [note("2026-11-16T10:00:00.004Z")],
      })
    ),
    null
  );
});
