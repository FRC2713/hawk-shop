import { useCallback, useMemo, useState } from "react";
import {
  EMPTY_SELECTION,
  pruneSelection,
  selectOnly,
  selectRange,
  toggleCard,
  type CardSelectHandler,
} from "~/lib/cardSelection";

/**
 * The board's selection. `columnOrder(columnId)` gives that column's card ids
 * in the order shown, which is what a shift-click ranges over. Cards that
 * leave the selected column drop out of the selection.
 */
export function useCardSelection<C extends { id: string; column_id: string }>(
  cards: readonly C[],
  columnOrder: (columnId: string) => readonly string[]
) {
  const [raw, setRaw] = useState(EMPTY_SELECTION);
  const selection = useMemo(() => pruneSelection(raw, cards), [raw, cards]);

  const selectedCards = useMemo(
    () => cards.filter((card) => selection.ids.has(card.id)),
    [cards, selection]
  );

  const onCardSelect = useCallback<CardSelectHandler>(
    (cardId, columnId, click) => {
      setRaw((current) => {
        const live = pruneSelection(current, cards);
        return click.shiftKey
          ? selectRange(live, cardId, columnId, columnOrder(columnId))
          : toggleCard(live, cardId, columnId);
      });
    },
    [cards, columnOrder]
  );

  const clear = useCallback(() => setRaw(EMPTY_SELECTION), []);

  /** Leave just `ids` selected, in the current column. */
  const keepOnly = useCallback(
    (ids: readonly string[]) =>
      setRaw((current) => selectOnly(ids, current.columnId)),
    []
  );

  return { selection, selectedCards, onCardSelect, clear, keepOnly };
}
