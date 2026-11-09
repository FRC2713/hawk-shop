import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPartsSearch } from "../src/onshape_connector/utils/partsSearch";

test("connector keeps infix candidates beside preferred shared matches and without an exact sibling", () => {
  const backplate = { name: "Backplate" };
  const plate = { name: "Plate" };
  assert.deepEqual(buildPartsSearch([backplate, plate]).search("plate"), [
    plate,
    backplate,
  ]);
  assert.deepEqual(buildPartsSearch([backplate]).search("plate"), [backplate]);
});

test("connector requires every word even when Fuse matches the rest of the query", () => {
  const search = buildPartsSearch([{ name: "Bracket" }, { name: "Plate" }]);
  assert.deepEqual(search.search("bracket x"), []);
  assert.deepEqual(search.search("bracket plate"), []);
});

test("connector combines per-word fuzzy and infix matches with shared fraction and part-number aliases", () => {
  const bracket = { name: "Backplate Bracket 0.5", partNumber: "2713-24-112" };
  const search = buildPartsSearch([bracket, { name: "Plate" }]);
  for (const query of [
    "plate brakett",
    "1/2 brakett",
    "24-112 plate",
    "112 1/2 brakett",
  ]) {
    assert.deepEqual(search.search(query), [bracket], query);
  }
  assert.deepEqual(search.search("   "), [bracket, { name: "Plate" }]);
});

test("connector prefers shared part-number matches while retaining fuzzy number siblings", () => {
  const exact = { name: "Bracket", partNumber: "2713-24-112" };
  const fuzzy = { name: "Spacer", partNumber: "2713-24-114" };
  for (const query of ["24-112", "112"]) {
    assert.deepEqual(buildPartsSearch([fuzzy, exact]).search(query), [
      exact,
      fuzzy,
    ]);
  }
});
