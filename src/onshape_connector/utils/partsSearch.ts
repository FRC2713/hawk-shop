import Fuse from "fuse.js";
import { buildSearchIndex, searchTerms } from "../../lib/search";
import type { BtPartMetadataInfo } from "../../lib/onshapeApi/generated-wrapper";

/** Build once per metadata snapshot; search without fetching more CAD data. */
export function buildPartsSearch(parts: BtPartMetadataInfo[]) {
  const entries = parts.map((part, position) => ({
    id: String(position),
    part,
  }));
  const index = buildSearchIndex(entries, [
    { value: ({ part }) => part.name, weight: 2 },
    { value: ({ part }) => part.partNumber, weight: 2 },
  ]);
  const fuse = new Fuse(parts, {
    keys: ["name", "partNumber"],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 1,
    includeScore: true,
  });
  return {
    search(query: string): BtPartMetadataInfo[] {
      const terms = searchTerms(query);
      if (!terms.length) return parts;
      const sharedScores = new Map(
        index.search(query).map(({ id, score }) => [Number(id), score])
      );
      // Each term may match shared aliases or Fuse's typo/infix rules.
      // Intersect those candidates so a fuzzy phrase cannot drop a query word.
      const termScores = terms.map((term) => {
        const scores = new Map(
          fuse.search(term).map(({ refIndex, score }) => [refIndex, score ?? 1])
        );
        for (const { id } of index.search(term)) scores.set(Number(id), 0);
        return scores;
      });
      return parts
        .map((part, position) => ({ part, position }))
        .filter(({ position }) =>
          termScores.every((scores) => scores.has(position))
        )
        .sort(
          (a, b) =>
            (sharedScores.get(b.position) ?? 0) -
              (sharedScores.get(a.position) ?? 0) ||
            termScores.reduce(
              (score, scores) =>
                score + scores.get(a.position)! - scores.get(b.position)!,
              0
            )
        )
        .map(({ part }) => part);
    },
  };
}
