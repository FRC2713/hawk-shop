import { useState, useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { KanbanColumnHeader } from "./KanbanColumnHeader";
import { Badge } from "~/components/ui/badge";
import type { KanbanColumn as KanbanColumnType } from "~/lib/kanbanApi/columnTypes";
import type { KanbanCardRow, UserRow } from "~/lib/db/types";
import { KanbanColumnCardContainer } from "./KanbanColumnCardContainer";

interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCardRow[];
  onRename: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
  isEditMode?: boolean;
  isDraggingCard?: boolean;
  hideImages?: boolean;
  usersMap: Map<string, UserRow>;
  isLastColumn?: boolean;
  selectedCardIds?: Set<string>;
  selectedColumnId?: string | null;
  onCardSelect?: (
    cardId: string,
    columnId: string,
    cardIndex: number,
    event: React.MouseEvent
  ) => void;
}

export function KanbanColumn({
  column,
  cards,
  onRename,
  onDelete,
  isEditMode = false,
  isDraggingCard = false,
  hideImages = false,
  usersMap,
  isLastColumn = false,
  selectedCardIds = new Set(),
  selectedColumnId = null,
  onCardSelect,
}: KanbanColumnProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Filter cards for the last column (Done) - only show cards from last 24 hours
  const { filteredCards, olderCardsCount } = useMemo(() => {
    if (!isLastColumn) {
      return { filteredCards: cards, olderCardsCount: 0 };
    }

    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    const filtered = cards.filter((card) => {
      const cardUpdated = new Date(card.date_updated).getTime();
      return cardUpdated > twentyFourHoursAgo;
    });

    const olderCount = cards.length - filtered.length;

    return { filteredCards: filtered, olderCardsCount: olderCount };
  }, [cards, isLastColumn]);

  const {
    attributes,
    listeners,
    setNodeRef: setColumnRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: column.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleRename = (newTitle: string) => {
    if (newTitle.trim()) {
      onRename(column.id, newTitle.trim());
    }
    setIsEditing(false);
  };

  const handleDelete = () => {
    onDelete(column.id);
    setIsDeleteDialogOpen(false);
  };

  // Combine refs for both sortable (column) and droppable (cards)
  const combinedRef = (node: HTMLElement | null) => {
    setColumnRef(node);
    setDroppableRef(node);
  };

  return (
    <>
      <div
        ref={combinedRef}
        style={style}
        className={`group/column bg-card flex h-full w-[280px] shrink-0 flex-col rounded-xl border transition-all duration-200 sm:w-[320px] ${
          isDragging
            ? "ring-primary/20 scale-[1.02] rotate-1 shadow-2xl ring-2"
            : ""
        } ${isOver ? "ring-primary ring-offset-background ring-2 ring-offset-2" : ""}`}
      >
        {/* Column Header */}
        <div className="bg-muted/30 flex items-center gap-2 rounded-t-xl border-b px-2 py-2 sm:px-3 sm:py-3">
          {/* Drag Handle - Always visible on touch devices, hover-only on desktop */}
          {isEditMode && (
            <button
              {...attributes}
              {...listeners}
              className="active:bg-muted hover:bg-muted cursor-grab touch-none rounded p-1 opacity-60 transition-all group-hover/column:opacity-100 hover:opacity-100 active:cursor-grabbing active:opacity-100"
              aria-label="Drag to reorder column"
            >
              <GripVertical className="text-muted-foreground size-4" />
            </button>
          )}

          {/* Column Title */}
          <div className="flex flex-1 items-center gap-2">
            <KanbanColumnHeader
              title={column.title}
              onRename={handleRename}
              isEditing={isEditing && !isLastColumn}
              onEditStart={() => !isLastColumn && setIsEditing(true)}
              onEditEnd={() => setIsEditing(false)}
              isReadOnly={isLastColumn}
            />
            <Badge variant="secondary" className="text-xs tabular-nums">
              {isLastColumn ? filteredCards.length : cards.length}
            </Badge>
          </div>

          {/* Column Menu - Always visible on touch devices, hover-only on desktop */}
          {isEditMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 opacity-60 transition-opacity group-hover/column:opacity-100 hover:opacity-100 active:opacity-100"
                >
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">Column options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {!isLastColumn && (
                  <>
                    <DropdownMenuItem onClick={() => setIsEditing(true)}>
                      <Pencil className="mr-2 size-4" />
                      Rename column
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {!isLastColumn && (
                  <DropdownMenuItem
                    onClick={() => setIsDeleteDialogOpen(true)}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete column
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Cards Container */}
        <KanbanColumnCardContainer
          columnName={column.title}
          cards={filteredCards}
          isDraggingCard={isDraggingCard}
          hideImages={hideImages}
          usersMap={usersMap}
          olderCardsCount={isLastColumn ? olderCardsCount : 0}
          columnId={column.id}
          selectedCardIds={selectedCardIds}
          selectedColumnId={selectedColumnId}
          onCardSelect={onCardSelect}
        />
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete column</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{column.title}"? Cards in this
              column will need to be moved first or they will become orphaned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
