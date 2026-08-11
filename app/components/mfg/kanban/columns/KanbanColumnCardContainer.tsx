import { PlusCircle, SquareDashedKanban, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import type { KanbanCardRow, UserRow } from "~/lib/db/types";
import { KanbanCard } from "../cards/KanbanCard";
import { Button } from "~/components/ui/button";

interface KanbanColumnCardContainerProps {
  columnName: string;
  cards: KanbanCardRow[];
  isDraggingCard?: boolean;
  hideImages?: boolean;
  usersMap: Map<string, UserRow>;
  olderCardsCount?: number;
  columnId?: string;
  selectedCardIds?: Set<string>;
  selectedColumnId?: string | null;
  onCardSelect?: (
    cardId: string,
    columnId: string,
    cardIndex: number,
    event: React.MouseEvent
  ) => void;
}

export function KanbanColumnCardContainer({
  columnName,
  cards,
  isDraggingCard = false,
  hideImages = false,
  usersMap,
  olderCardsCount = 0,
  columnId = "",
  selectedCardIds = new Set(),
  selectedColumnId = null,
  onCardSelect,
}: KanbanColumnCardContainerProps) {
  const router = useRouter();

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
        <p className="text-muted-foreground text-xs sm:text-sm">No cards</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
      {cards.map((card, index) => (
        <KanbanCard
          key={card.id}
          card={card}
          hideImages={hideImages}
          usersMap={usersMap}
          isSelected={selectedCardIds.has(card.id)}
          columnId={columnId}
          cardIndex={index}
          onSelect={onCardSelect}
        />
      ))}
      {olderCardsCount > 0 && (
        <Button
          variant="outline"
          className="hover:bg-muted/50 flex w-full items-center justify-center gap-2 border-dashed py-6"
          onClick={() => router.push("/kanban/done")}
        >
          <span className="text-sm font-medium">
            View {olderCardsCount} older card{olderCardsCount !== 1 ? "s" : ""}
          </span>
          <ArrowRight className="size-4" />
        </Button>
      )}
    </div>
  );
}
