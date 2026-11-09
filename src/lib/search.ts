/** Pure, shared search over caller-selected fields. Higher scores rank first. */
export interface SearchField<T> {
  value: (item: T) => string | null | undefined;
  weight?: number;
}

export function searchTerms(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/(\d)\s+in\b/g, "$1")
      .match(/[\p{L}\p{N}]+(?:[-/.][\p{L}\p{N}]+)*/gu) || []
  ).map((word) => word.replace(/^(\d+(?:[./-]\d+)*)in$/, "$1"));
}

function aliases(word: string): string[] {
  const fraction = /^(?:(\d+)-)?(\d+)\/(\d+)$/.exec(word);
  if (!fraction || Number(fraction[3]) === 0) return [word];
  return [
    word,
    String(
      Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3])
    ),
  ];
}

export function buildSearchIndex<T extends { id: string }>(
  items: readonly T[],
  fields: readonly SearchField<T>[]
) {
  const entries = items.map((item) => ({
    id: item.id,
    tokens: fields.flatMap((field) =>
      searchTerms(field.value(item) || "").flatMap((word) => {
        const segments = word.split(/[-/]/);
        const tokens = [word, ...segments];
        for (let i = 1; i < segments.length; i++) {
          tokens.push(segments.slice(i).join("-"));
        }
        return tokens
          .flatMap(aliases)
          .map((token) => ({ token, weight: field.weight ?? 1 }));
      })
    ),
  }));

  return {
    search(query: string): { id: string; score: number }[] {
      const terms = searchTerms(query);
      return entries
        .flatMap(({ id, tokens }) => {
          let score = 0;
          for (const term of terms) {
            const best = Math.max(
              0,
              ...tokens.map(({ token, weight }) =>
                aliases(term).some((alias) => token === alias)
                  ? 100 * weight
                  : aliases(term).some((alias) => token.startsWith(alias))
                    ? weight
                    : 0
              )
            );
            if (!best) return [];
            score += best;
          }
          return [{ id, score }];
        })
        .sort((a, b) => b.score - a.score);
    },
  };
}
