import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Cog, FolderKanban } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import type { KanbanCardWithProcesses } from "~/lib/api";
import type { UserRow } from "~/server/db/types";
import type { KanbanColumn } from "~/server/kanbanApi/columnTypes";
import { cn } from "~/lib/utils";
import { KanbanCard } from "../cards/KanbanCard";
import type { BoardDensity } from "~/hooks/useBoardDensity";
import { DONE_TODAY_TITLE } from "~/lib/doneToday";
import type { BoardRow } from "~/lib/boardRows";

/**
 * Droppable ids for row cells; a drop moves the card's column only, never its
 * process or project.
 */
const CELL_PREFIX = "row|";
export function laneCellId(rowId: string, columnId: string) {
  return `${CELL_PREFIX}${rowId}|${columnId}`;
}
/** The column a drop target stands for, whether a column or a row cell. */
export function dropTargetColumnId(overId: string) {
  if (!overId.startsWith(CELL_PREFIX)) return overId;
  const rest = overId.slice(CELL_PREFIX.length);
  return rest.slice(rest.indexOf("|") + 1);
}

export type Lane = BoardRow;

const COLUMN_WIDTH = "w-[280px] sm:w-[320px]";
const ROW_HEADER_WIDTH = "w-40";

function LaneCell({
  laneId,
  column,
  cards,
  density,
  usersMap,
  isDraggingCard,
  selectedCardIds,
  columnIndexOf,
  onCardSelect,
}: {
  laneId: string;
  column: KanbanColumn;
  cards: KanbanCardWithProcesses[];
  density: BoardDensity;
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
          density={density}
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
 * One horizontal row per process or project, each running across every status
 * column under a header with its name (and, for processes, its machines).
 * Rows come in the order given; `rowOf` names the one row each card is in.
 * Empty cells stay drop targets. Collapsing is per browser tab.
 */
export function KanbanSwimlanes({
  columns,
  rowKind,
  lanes,
  rowOf,
  cardsByColumn,
  density,
  usersMap,
  isDraggingCard,
  selectedCardIds,
  onCardSelect,
}: {
  columns: KanbanColumn[];
  rowKind: "Process" | "Project";
  lanes: Lane[];
  rowOf: (card: KanbanCardWithProcesses) => string;
  cardsByColumn: Record<string, KanbanCardWithProcesses[]>;
  density: BoardDensity;
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
    (cardsByColumn[columnId] ?? []).filter((card) => rowOf(card) === laneId);
  const RowIcon = rowKind === "Process" ? Cog : FolderKanban;

  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="inline-flex min-w-full flex-col gap-3">
        <div className="bg-background sticky top-0 z-20 flex gap-3 pb-1 sm:gap-4">
          <div
            className={cn(
              "bg-background sticky left-0 shrink-0",
              ROW_HEADER_WIDTH
            )}
          />
          {columns.map((column, index) => (
            <div
              key={column.id}
              className={cn(
                "bg-muted/30 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2",
                COLUMN_WIDTH
              )}
            >
              <span className="font-heading font-semibold">
                {index === columns.length - 1 ? DONE_TODAY_TITLE : column.title}
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
              aria-label={`${rowKind} ${lane.name}`}
              className="flex gap-3 sm:gap-4"
            >
              <div
                className={cn(
                  "bg-background sticky left-0 z-10 flex shrink-0 flex-col gap-0.5 py-1",
                  ROW_HEADER_WIDTH
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(lane.id)}
                  aria-expanded={!isCollapsed}
                  className="hover:bg-muted flex w-full items-start gap-1.5 rounded-md px-1 py-1 text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronDown
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <RowIcon
                    className="size-4 shrink-0 text-[var(--hawk-teal)]"
                    aria-hidden="true"
                  />
                  <span className="font-heading min-w-0 leading-tight font-semibold break-words">
                    {lane.name}
                  </span>
                  <Badge
                    variant="secondary"
                    className="ml-auto text-xs tabular-nums"
                  >
                    {count}
                  </Badge>
                </button>
                {lane.meta && (
                  <span className="text-muted-foreground px-1 text-xs">
                    {lane.meta}
                  </span>
                )}
                {lane.archived && (
                  <span className="text-muted-foreground px-1 text-xs">
                    Archived
                  </span>
                )}
              </div>
              {!isCollapsed && (
                <div className="flex gap-3 sm:gap-4">
                  {columns.map((column, index) => (
                    <LaneCell
                      key={column.id}
                      laneId={lane.id}
                      column={
                        index === columns.length - 1
                          ? { ...column, title: DONE_TODAY_TITLE }
                          : column
                      }
                      cards={inLane(lane.id, column.id)}
                      density={density}
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
