import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, FolderKanban } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import type { KanbanCardWithProcesses } from "~/lib/api";
import type { UserRow } from "~/server/db/types";
import type { KanbanColumn } from "~/server/kanbanApi/columnTypes";
import { cn } from "~/lib/utils";
import { KanbanCard } from "../cards/KanbanCard";

/** Droppable ids for lane cells; a drop moves the card's column only. */
const CELL_PREFIX = "lane|";
export function laneCellId(projectId: string, columnId: string) {
  return `${CELL_PREFIX}${projectId}|${columnId}`;
}
/** The column a drop target stands for, whether a column or a lane cell. */
export function dropTargetColumnId(overId: string) {
  if (!overId.startsWith(CELL_PREFIX)) return overId;
  const rest = overId.slice(CELL_PREFIX.length);
  return rest.slice(rest.indexOf("|") + 1);
}

export type Lane = { id: string; name: string; archived: boolean };

const COLUMN_WIDTH = "w-[280px] sm:w-[320px]";

function LaneCell({
  laneId,
  column,
  cards,
  hideImages,
  usersMap,
  isDraggingCard,
  selectedCardIds,
  columnIndexOf,
  onCardSelect,
}: {
  laneId: string;
  column: KanbanColumn;
  cards: KanbanCardWithProcesses[];
  hideImages: boolean;
  usersMap: Map<string, UserRow>;
  isDraggingCard: boolean;
  selectedCardIds: Set<string>;
  columnIndexOf: (card: KanbanCardWithProcesses) => number;
  onCardSelect?: (
    cardId: string,
    columnId: string,
    cardIndex: number,
    event: React.MouseEvent
  ) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: laneCellId(laneId, column.id),
  });
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={column.title}
      className={cn(
        "bg-card flex min-h-16 shrink-0 flex-col gap-2 rounded-lg border p-2",
        COLUMN_WIDTH,
        isDraggingCard && "border-primary/30 border-dashed",
        isOver && "ring-primary ring-2"
      )}
    >
      {cards.map((card) => (
        <KanbanCard
          key={card.id}
          card={card}
          hideImages={hideImages}
          usersMap={usersMap}
          isSelected={selectedCardIds.has(card.id)}
          columnId={column.id}
          cardIndex={columnIndexOf(card)}
          onSelect={onCardSelect}
        />
      ))}
    </div>
  );
}

/**
 * One horizontal band per project, each running across every status column.
 * Lanes come in the order given (alphabetical, Miscellaneous last); lanes with
 * no matching cards are not passed in. Collapsing is per browser tab.
 */
export function KanbanSwimlanes({
  columns,
  lanes,
  cardsByColumn,
  hideImages,
  usersMap,
  isDraggingCard,
  selectedCardIds,
  onCardSelect,
}: {
  columns: KanbanColumn[];
  lanes: Lane[];
  cardsByColumn: Record<string, KanbanCardWithProcesses[]>;
  hideImages: boolean;
  usersMap: Map<string, UserRow>;
  isDraggingCard: boolean;
  selectedCardIds: Set<string>;
  onCardSelect?: (
    cardId: string,
    columnId: string,
    cardIndex: number,
    event: React.MouseEvent
  ) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const inLane = (laneId: string, columnId: string) =>
    (cardsByColumn[columnId] ?? []).filter(
      (card) => card.project_id === laneId
    );

  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="inline-flex min-w-full flex-col gap-3">
        <div className="bg-background sticky top-0 z-10 flex gap-3 pb-1 sm:gap-4">
          {columns.map((column, index) => (
            <div
              key={column.id}
              className={cn(
                "bg-muted/30 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2",
                COLUMN_WIDTH
              )}
            >
              <span className="font-heading font-semibold">
                {index === columns.length - 1 ? "Done" : column.title}
              </span>
              <Badge
                variant="secondary"
                className="text-xs tabular-nums"
                aria-label="Matching cards"
              >
                {cardsByColumn[column.id]?.length ?? 0}
              </Badge>
            </div>
          ))}
        </div>
        {lanes.map((lane) => {
          const isCollapsed = collapsed.has(lane.id);
          const count = columns.reduce(
            (sum, column) => sum + inLane(lane.id, column.id).length,
            0
          );
          return (
            <section
              key={lane.id}
              aria-label={`Project ${lane.name}`}
              className="flex flex-col gap-2"
            >
              <button
                type="button"
                onClick={() => toggle(lane.id)}
                aria-expanded={!isCollapsed}
                className="hover:bg-muted sticky left-0 flex w-fit items-center gap-2 rounded-md px-2 py-1 text-left"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-4" aria-hidden="true" />
                )}
                <FolderKanban
                  className="size-4 text-[var(--hawk-teal)]"
                  aria-hidden="true"
                />
                <span className="font-heading font-semibold">{lane.name}</span>
                {lane.archived && (
                  <span className="text-muted-foreground text-xs">
                    (archived)
                  </span>
                )}
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {count}
                </Badge>
              </button>
              {!isCollapsed && (
                <div className="flex gap-3 sm:gap-4">
                  {columns.map((column) => (
                    <LaneCell
                      key={column.id}
                      laneId={lane.id}
                      column={column}
                      cards={inLane(lane.id, column.id)}
                      hideImages={hideImages}
                      usersMap={usersMap}
                      isDraggingCard={isDraggingCard}
                      selectedCardIds={selectedCardIds}
                      columnIndexOf={(card) =>
                        (cardsByColumn[column.id] ?? []).indexOf(card)
                      }
                      onCardSelect={onCardSelect}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
