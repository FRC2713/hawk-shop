/**
 * The board's card selection: a set of cards in one column, plus the card a
 * shift-click ranges from. Pure and client-safe; `useCardSelection` holds it
 * in React state.
 *
 * Ranges are by card id over the column's cards in the order the board shows
 * them, so they work whatever rows split the column.
 */

export interface CardSelection {
  ids: ReadonlySet<string>;
  /** The column every selected card is in; null when nothing is selected. */
  columnId: string | null;
  /** The last card clicked, where the next shift-click ranges from. */
  anchorId: string | null;
}

export const EMPTY_SELECTION: CardSelection = {
  ids: new Set(),
  columnId: null,
  anchorId: null,
};

/** Add or remove one card. A card in another column starts over. */
export function toggleCard(
  selection: CardSelection,
  cardId: string,
  columnId: string
): CardSelection {
  if (selection.columnId !== columnId)
    return { ids: new Set([cardId]), columnId, anchorId: cardId };
  const ids = new Set(selection.ids);
  if (ids.has(cardId)) ids.delete(cardId);
  else ids.add(cardId);
  if (ids.size === 0) return EMPTY_SELECTION;
  return { ids, columnId, anchorId: cardId };
}

/**
 * Add every card from the anchor to `cardId` in `columnOrder` (the column's
 * card ids as shown). Without an anchor in that column it selects just
 * `cardId`.
 */
export function selectRange(
  selection: CardSelection,
  cardId: string,
  columnId: string,
  columnOrder: readonly string[]
): CardSelection {
  const from =
    selection.columnId === columnId && selection.anchorId
      ? columnOrder.indexOf(selection.anchorId)
      : -1;
  const to = columnOrder.indexOf(cardId);
  if (from < 0 || to < 0) return toggleCard(EMPTY_SELECTION, cardId, columnId);
  const ids = new Set(selection.ids);
  for (const id of columnOrder.slice(
    Math.min(from, to),
    Math.max(from, to) + 1
  ))
    ids.add(id);
  return { ids, columnId, anchorId: cardId };
}

/**
 * Keep only selected cards that are still in the selection's column, e.g.
 * after a move or a live update elsewhere.
 */
export function pruneSelection(
  selection: CardSelection,
  cards: readonly { id: string; column_id: string }[]
): CardSelection {
  if (selection.ids.size === 0) return selection;
  const still = new Set(
    cards
      .filter(
        (card) =>
          card.column_id === selection.columnId && selection.ids.has(card.id)
      )
      .map((card) => card.id)
  );
  if (still.size === selection.ids.size) return selection;
  if (still.size === 0) return EMPTY_SELECTION;
  return { ...selection, ids: still };
}

/** Select exactly `ids` (all in `columnId`), e.g. the cards an action left. */
export function selectOnly(
  ids: readonly string[],
  columnId: string | null
): CardSelection {
  if (ids.length === 0 || !columnId) return EMPTY_SELECTION;
  return { ids: new Set(ids), columnId, anchorId: ids[ids.length - 1] };
}

/** The modifier keys a select click carries. */
export type SelectClick = Pick<MouseEvent, "shiftKey" | "metaKey" | "ctrlKey">;

/** What a card calls to change the selection; shift ranges, else toggles. */
export type CardSelectHandler = (
  cardId: string,
  columnId: string,
  click: SelectClick
) => void;
