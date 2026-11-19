import { PlusCircle, SquareDashedKanban } from "lucide-react";
import type { KanbanCardRow, UserRow } from "~/server/db/types";
import { KanbanCard } from "../cards/KanbanCard";
import type { BoardDensity } from "~/hooks/useBoardDensity";
import type { CardSelectHandler } from "~/lib/cardSelection";
import { OlderDoneLink } from "./OlderDoneLink";

interface KanbanColumnCardContainerProps {
  columnName: string;
  cards: KanbanCardRow[];
  isDraggingCard?: boolean;
  density?: BoardDensity;
  usersMap: Map<string, UserRow>;
  now: number;
  olderCardsCount?: number;
  isFiltered?: boolean;
  columnId?: string;
  selectedCardIds?: ReadonlySet<string>;
  selectedColumnId?: string | null;
  onCardSelect?: CardSelectHandler;
}

export function KanbanColumnCardContainer({
  columnName,
  cards,
  isDraggingCard = false,
  density = "compact",
  usersMap,
  now,
  olderCardsCount = 0,
  isFiltered = false,
  columnId = "",
  selectedCardIds = new Set(),
  selectedColumnId = null,
  onCardSelect,
}: KanbanColumnCardContainerProps) {
  if (isDraggingCard) {
    return (
      <div className="border-primary/20 flex h-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-colors">
        <PlusCircle className="text-primary/50 size-6" />
        <p className="text-primary text-xs sm:text-sm">Move to {columnName}</p>
      </div>
    );
  }
  if (cards.length === 0 && olderCardsCount === 0) {
    return (
      <div className="border-secondary/20 flex h-full flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors">
        <SquareDashedKanban className="text-muted-foreground/50 size-6" />
        <p className="text-muted-foreground text-xs sm:text-sm">
          {isFiltered ? "No matching cards" : "No cards"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
      {cards.map((card) => (
        <KanbanCard
          key={card.id}
          card={card}
          density={density}
          usersMap={usersMap}
          now={now}
          isSelected={selectedCardIds.has(card.id)}
          columnId={columnId}
          onSelect={onCardSelect}
        />
      ))}
      <OlderDoneLink count={olderCardsCount} className="w-full py-6" />
    </div>
  );
}
