import { useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Cog, FolderKanban } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import type { KanbanCardWithProcesses } from "~/lib/api";
import type { UserRow } from "~/server/db/types";
import type { KanbanColumn } from "~/server/kanbanApi/columnTypes";
import { cn } from "~/lib/utils";
import { KanbanCard } from "../cards/KanbanCard";
import { OlderDoneLink } from "../columns/OlderDoneLink";
import type { BoardDensity } from "~/hooks/useBoardDensity";
import { DONE_TODAY_TITLE } from "~/lib/doneToday";
import type { CardSelectHandler } from "~/lib/cardSelection";
import type { BoardRow } from "~/lib/boardRows";

/**
 * Droppable ids for row cells; a drop moves the card's column only, never its
 * process or project.
 */
const CELL_PREFIX = "row|";
export function rowCellId(rowId: string, columnId: string) {
  return `${CELL_PREFIX}${rowId}|${columnId}`;
}
/** The column a drop target stands for, whether a column or a row cell. */
export function dropTargetColumnId(overId: string) {
  if (!overId.startsWith(CELL_PREFIX)) return overId;
  const rest = overId.slice(CELL_PREFIX.length);
  return rest.slice(rest.indexOf("|") + 1);
}

const COLUMN_WIDTH = "w-[280px] sm:w-[320px]";
const ROW_HEADER_WIDTH = "w-40";

function RowCell({
  rowId,
  column,
  cards,
  density,
  usersMap,
  now,
  isDraggingCard,
  selectedCardIds,
  onCardSelect,
}: {
  rowId: string;
  column: KanbanColumn;
  cards: KanbanCardWithProcesses[];
  density: BoardDensity;
  usersMap: Map<string, UserRow>;
  now: number;
  isDraggingCard: boolean;
  selectedCardIds: ReadonlySet<string>;
  onCardSelect?: CardSelectHandler;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: rowCellId(rowId, column.id),
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
          now={now}
          isSelected={selectedCardIds.has(card.id)}
          columnId={column.id}
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
 * Empty cells stay drop targets. The board owns which rows are collapsed, so
 * shift-click ranges skip the cards a collapsed row hides. Done holds today's
 * parts; its header links to the older ones.
 */
export function KanbanRows({
  columns,
  rowKind,
  rows,
  rowOf,
  cardsByColumn,
  olderDoneCount,
  density,
  usersMap,
  now,
  isDraggingCard,
  selectedCardIds,
  onCardSelect,
  collapsedRows,
  onToggleRow,
}: {
  columns: KanbanColumn[];
  rowKind: "Process" | "Project";
  rows: BoardRow[];
  rowOf: (card: KanbanCardWithProcesses) => string;
  cardsByColumn: Record<string, KanbanCardWithProcesses[]>;
  olderDoneCount: number;
  density: BoardDensity;
  usersMap: Map<string, UserRow>;
  now: number;
  isDraggingCard: boolean;
  selectedCardIds: ReadonlySet<string>;
  onCardSelect?: CardSelectHandler;
  collapsedRows: ReadonlySet<string>;
  onToggleRow: (rowId: string) => void;
}) {
  const inRow = (rowId: string, columnId: string) =>
    (cardsByColumn[columnId] ?? []).filter((card) => rowOf(card) === rowId);
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
          {columns.map((column, index) => {
            const isDone = index === columns.length - 1;
            return (
              <div
                key={column.id}
                className={cn(
                  "bg-muted/30 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2",
                  COLUMN_WIDTH
                )}
              >
                <span className="font-heading font-semibold">
                  {isDone ? DONE_TODAY_TITLE : column.title}
                </span>
                <Badge
                  variant="secondary"
                  className="brand-figures text-xs"
                  aria-label="Matching cards"
                >
                  {cardsByColumn[column.id]?.length ?? 0}
                </Badge>
                {isDone && (
                  <OlderDoneLink
                    count={olderDoneCount}
                    className="ml-auto h-7 px-2"
                  />
                )}
              </div>
            );
          })}
        </div>
        {rows.map((row) => {
          const isCollapsed = collapsedRows.has(row.id);
          const count = columns.reduce(
            (sum, column) => sum + inRow(row.id, column.id).length,
            0
          );
          return (
            <section
              key={row.id}
              aria-label={`${rowKind} ${row.name}`}
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
                  onClick={() => onToggleRow(row.id)}
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
                    {row.name}
                  </span>
                  <Badge
                    variant="secondary"
                    className="brand-figures ml-auto text-xs"
                  >
                    {count}
                  </Badge>
                </button>
                {row.meta && (
                  <span className="text-muted-foreground px-1 text-xs">
                    {row.meta}
                  </span>
                )}
                {row.archived && (
                  <span className="text-muted-foreground px-1 text-xs">
                    Archived
                  </span>
                )}
              </div>
              {!isCollapsed && (
                <div className="flex gap-3 sm:gap-4">
                  {columns.map((column, index) => (
                    <RowCell
                      key={column.id}
                      rowId={row.id}
                      column={
                        index === columns.length - 1
                          ? { ...column, title: DONE_TODAY_TITLE }
                          : column
                      }
                      cards={inRow(row.id, column.id)}
                      density={density}
                      usersMap={usersMap}
                      now={now}
                      isDraggingCard={isDraggingCard}
                      selectedCardIds={selectedCardIds}
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
