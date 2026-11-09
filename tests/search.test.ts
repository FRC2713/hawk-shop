import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchIndex } from "../src/lib/search";

const cards = [
  { id: "bracket", title: "2713-24-112 Bracket" },
  { id: "plate", title: "2713-24-113 Plate" },
];
const fields = [
  { value: (card: (typeof cards)[number]) => card.title, weight: 2 },
];

for (const query of ["24-112", "112", "2713-24-112"]) {
  test(`${query} finds the part number`, () => {
    assert.deepEqual(
      buildSearchIndex(cards, fields)
        .search(query)
        .map((hit) => hit.id),
      ["bracket"]
    );
  });
}

for (const [title, query] of [
  ["0.5 Plate", "1/2"],
  ["1/2 Plate", "0.5"],
  ["1.5 Plate", "1-1/2"],
  ["1-1/2 Plate", "1.5"],
  ['0.5" Plate,', "1/2in PLATE!"],
  ["1/2in Plate", '0.5"'],
]) {
  test(`${query} matches dimension ${title}`, () => {
    assert.deepEqual(
      buildSearchIndex([{ id: "dimension", title }], fields)
        .search(query)
        .map((hit) => hit.id),
      ["dimension"]
    );
  });
}

for (const [query, ids] of [
  ["bracket plate", []],
  ["", ["bracket", "plate"]],
  ["  ", ["bracket", "plate"]],
  ["BRACK!", ["bracket"]],
  ["112 brack", ["bracket"]],
] as const) {
  test(`AND search ${JSON.stringify(query)} returns the expected cards`, () => {
    assert.deepEqual(
      buildSearchIndex(cards, fields)
        .search(query)
        .map((hit) => hit.id),
      ids
    );
  });
}

test("exact ranks above prefix, then title and part number above supporting fields", () => {
  const items = [
    { id: "prefix", title: "Bracket", person: "" },
    { id: "person", title: "Plate", person: "Brack" },
    { id: "title", title: "Brack", person: "" },
  ];
  const index = buildSearchIndex(items, [
    { value: (item) => item.title, weight: 2 },
    { value: (item) => item.person },
  ]);
  assert.deepEqual(
    index.search("brack").map((hit) => hit.id),
    ["title", "person", "prefix"]
  );
});

for (const query of ["1/2 in", "0.5 in", '0.5"']) {
  test(`dimension units are optional in ${query}`, () => {
    assert.deepEqual(
      buildSearchIndex([{ id: "dimension", title: "1/2 in Plate" }], fields)
        .search(query)
        .map((hit) => hit.id),
      ["dimension"]
    );
    assert.deepEqual(
      buildSearchIndex([{ id: "dimension", title: "0.5 Plate" }], fields)
        .search(query)
        .map((hit) => hit.id),
      ["dimension"]
    );
  });
}
