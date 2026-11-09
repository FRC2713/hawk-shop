import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkPartForRelease,
  isPartEligibleForRelease,
} from "../src/onshape_connector/utils/partEligibility";
import type { BtPartMetadataInfo } from "../src/lib/onshapeApi/generated-wrapper";
const clean: BtPartMetadataInfo = {
  partNumber: "2713-24-112",
  material: { displayName: "6061 Aluminum" },
  description: "Drive bracket",
};

test("clean versioned part has no release issues", () => {
  assert.deepEqual(
    checkPartForRelease(clean, {
      instanceType: "v",
      quantityPerRobot: 2,
      quantityToMake: 4,
    }),
    []
  );
});

for (const [code, part, context] of [
  ["missing-material", { ...clean, material: undefined }, {}],
  ["missing-part-number", { ...clean, partNumber: undefined }, {}],
  ["already-on-board", clean, { matchingCard: { id: "existing" } }],
] as const) {
  test(`${code} blocks release and preserves legacy eligibility`, () => {
    const issues = checkPartForRelease(part, context);
    assert.deepEqual(
      issues.map(({ code, severity }) => ({ code, severity })),
      [{ code, severity: "error" }]
    );
    assert.ok(issues[0].message);
    assert.ok(issues[0].fix);
    assert.equal(isPartEligibleForRelease(part, context.matchingCard), false);
  });
}

test("placeholder-material warns without blocking release", () => {
  const part = { ...clean, material: { displayName: "  UNKNOWN " } };
  const issues = checkPartForRelease(part, {});
  assert.deepEqual(
    issues.map(({ code, severity }) => ({ code, severity })),
    [{ code: "placeholder-material", severity: "warning" }]
  );
  assert.ok(issues[0].fix);
  assert.equal(isPartEligibleForRelease(part, undefined), true);
});

test("quantity-below-per-robot warns without blocking release", () => {
  const part = clean;
  const issues = checkPartForRelease(part, {
    quantityPerRobot: 4,
    quantityToMake: 2,
  });
  assert.deepEqual(
    issues.map(({ code, severity }) => ({ code, severity })),
    [{ code: "quantity-below-per-robot", severity: "warning" }]
  );
  assert.ok(issues[0].fix);
  assert.equal(isPartEligibleForRelease(part, undefined), true);
});

test("missing-description warns without blocking release", () => {
  const part = { ...clean, description: "  " };
  const issues = checkPartForRelease(part, {});
  assert.deepEqual(
    issues.map(({ code, severity }) => ({ code, severity })),
    [{ code: "missing-description", severity: "warning" }]
  );
  assert.ok(issues[0].fix);
  assert.equal(isPartEligibleForRelease(part, undefined), true);
});

test("released-from-workspace warns without blocking release", () => {
  const part = clean;
  const issues = checkPartForRelease(part, { instanceType: "w" });
  assert.deepEqual(
    issues.map(({ code, severity }) => ({ code, severity })),
    [{ code: "released-from-workspace", severity: "warning" }]
  );
  assert.ok(issues[0].fix);
  assert.equal(isPartEligibleForRelease(part, undefined), true);
});

test("placeholder names can be replaced or disabled without mutating the part", () => {
  const part = { ...clean, material: { displayName: "Team stock TBD" } };
  assert.deepEqual(checkPartForRelease(part), []);
  assert.deepEqual(
    checkPartForRelease(part, { placeholderMaterials: ["team stock tbd"] }).map(
      (issue) => issue.code
    ),
    ["placeholder-material"]
  );
  assert.deepEqual(
    checkPartForRelease(
      { ...clean, material: { displayName: "Unknown" } },
      { placeholderMaterials: [] }
    ),
    []
  );
  assert.equal(part.material.displayName, "Team stock TBD");
});

test("all issues are returned together, and absent quantities do not warn", () => {
  assert.deepEqual(
    checkPartForRelease(undefined, {
      instanceType: "w",
      matchingCard: { id: "existing" },
    })
      .map((issue) => issue.code)
      .sort(),
    [
      "already-on-board",
      "missing-description",
      "missing-material",
      "missing-part-number",
      "released-from-workspace",
    ]
  );
  assert.equal(isPartEligibleForRelease(clean, undefined), true);
  assert.equal(isPartEligibleForRelease(undefined, undefined), false);
  assert.deepEqual(
    checkPartForRelease(clean, {
      quantityPerRobot: 4,
      quantityToMake: 4,
      instanceType: "m",
    }),
    []
  );
});
