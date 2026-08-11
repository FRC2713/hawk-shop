import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Columns3, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  KanbanColumn as KanbanColumnType,
  KanbanConfig,
} from "~/lib/kanbanApi/columnTypes";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  kanbanQueryKeys,
  useKanbanCards,
  useUsers,
} from "~/lib/kanbanApi/queries";
import type { KanbanCardRow, UserRow } from "~/lib/db/types";
import { KanbanCard as KanbanCardComponent } from "../cards/KanbanCard";
import { KanbanColumn } from "../columns/KanbanColumn";
import { KanbanBulkEditBar } from "./KanbanBulkEditBar";

interface KanbanBoardProps {
  config: KanbanConfig;
  onConfigChange: (config: KanbanConfig) => void;
  isEditMode?: boolean;
  hideImages?: boolean;
  processFilterIds?: string[];
  sortByUser?: boolean;
  searchQuery?: string;
  onAddColumn?: () => void;
  onRenameColumn?: (id: string, newTitle: string) => void;
  onDeleteColumn?: (id: string) => void;
  onReorderColumns?: (newColumns: KanbanColumnType[]) => void;
}

export function KanbanBoard({
  config,
  onConfigChange,
  isEditMode = false,
  hideImages = false,
  processFilterIds = [],
  sortByUser = false,
  searchQuery = "",
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onReorderColumns,
}: KanbanBoardProps) {
  const [activeCard, setActiveCard] = useState<KanbanCardRow | null>(null);
  const [draggingCards, setDraggingCards] = useState<KanbanCardRow[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [lastClickedCardIndex, setLastClickedCardIndex] = useState<
    number | null
  >(null);
  const [lastClickedColumnId, setLastClickedColumnId] = useState<string | null>(
    null
  );
  const queryClient = useQueryClient();

  // Use columns directly from config
  const columns = config.columns;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch cards and users
  const { data: cardsData, isLoading: isLoadingCards } = useKanbanCards();
  const { data: users = [] } = useUsers();

  const cards = cardsData?.cards || [];

  // Filter cards by search query and process filter
  const filteredCards = useMemo(() => {
    let result = cards;

    // Filter by search query (part number or name via title/content)
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((card) => {
        const titleMatch = card.title?.toLowerCase().includes(query);
        const contentMatch = card.content?.toLowerCase().includes(query);
        return titleMatch || contentMatch;
      });
    }

    // Filter by process: when processFilterIds has values, only show cards that have at least one of those processes
    if (processFilterIds.length > 0) {
      result = result.filter((card) => {
        const cardProcesses =
          (card as KanbanCardRow & { processes?: { id: string }[] })
            .processes || [];
        const cardProcessIds = cardProcesses.map((p) => p.id);
        return processFilterIds.some((id) => cardProcessIds.includes(id));
      });
    }

    return result;
  }, [cards, searchQuery, processFilterIds]);

  // Create user lookup map for O(1) access
  const usersMap = useMemo(() => {
    const map = new Map<string, UserRow>();
    users.forEach((user) => {
      map.set(user.onshape_user_id, user);
    });
    return map;
  }, [users]);

  // Mutation to update card column
  const moveCardMutation = useMutation({
    mutationFn: async ({
      cardId,
      columnId,
    }: {
      cardId: string;
      columnId: string;
    }) => {
      const formData = new FormData();
      formData.append("action", "moveCard");
      formData.append("cardId", cardId);
      formData.append("columnId", columnId);

      const response = await fetch("/api/mfg/parts/actions", {
        method: "POST",
        body: formData,
      });

      // Check content type before parsing
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(
          `Expected JSON response but got ${contentType}. Response: ${text.substring(0, 100)}`
        );
      }

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.error || "Failed to move card";
        throw new Error(errorMessage);
      }

      return data;
    },
    onMutate: async ({ cardId, columnId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: kanbanQueryKeys.cards() });

      // Snapshot previous value
      const previousCards = queryClient.getQueryData<{
        cards: KanbanCardRow[];
      }>(kanbanQueryKeys.cards());

      // Optimistically update
      if (previousCards) {
        queryClient.setQueryData<{ cards: KanbanCardRow[] }>(
          kanbanQueryKeys.cards(),
          {
            cards: previousCards.cards.map((card) =>
              card.id === cardId ? { ...card, column_id: columnId } : card
            ),
          }
        );
      }

      return { previousCards };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousCards) {
        queryClient.setQueryData(
          kanbanQueryKeys.cards(),
          context.previousCards
        );
      }
      toast.error("Failed to move card", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: kanbanQueryKeys.cards() });
    },
  });

  // Group cards by column, optionally sorted by process or user
  const cardsByColumn = useMemo(() => {
    const grouped: Record<string, KanbanCardRow[]> = {};

    // First, group by column (using filtered cards)
    filteredCards.forEach((card) => {
      if (!grouped[card.column_id]) {
        grouped[card.column_id] = [];
      }
      grouped[card.column_id].push(card);
    });

    // Sort cards within each column
    Object.keys(grouped).forEach((columnId) => {
      grouped[columnId].sort((a, b) => {
        // Sort by user if enabled
        if (sortByUser) {
          const aAssignee = a.assignee || "zzz_Unassigned";
          const bAssignee = b.assignee || "zzz_Unassigned";
          const userCompare = aAssignee.localeCompare(bAssignee);

          // If users are different, return the comparison
          // Otherwise, maintain original order
          if (userCompare !== 0) {
            return userCompare;
          }
        }

        // If no sorting or same values, maintain original order
        return 0;
      });
    });

    return grouped;
  }, [filteredCards, sortByUser]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;

    // Check if we're dragging a card
    const card = cards.find((c) => c.id === active.id);
    if (card) {
      // Check if this card is selected and in the selected column
      const isSelected = selectedCardIds.has(card.id);
      const isInSelectedColumn = selectedColumnId === card.column_id;

      if (isSelected && isInSelectedColumn && selectedCardIds.size > 1) {
        // Drag all selected cards from the same column
        const selectedCards = Array.from(selectedCardIds)
          .map((id) => cards.find((c) => c.id === id))
          .filter(
            (c): c is KanbanCardRow =>
              c !== undefined && c.column_id === card.column_id
          )
          .sort((a, b) => {
            // Maintain order based on their position in the column
            const columnCards = cardsByColumn[card.column_id] || [];
            const aIndex = columnCards.findIndex((c) => c.id === a.id);
            const bIndex = columnCards.findIndex((c) => c.id === b.id);
            return aIndex - bIndex;
          });
        setDraggingCards(selectedCards);
        setActiveCard(card); // Use the dragged card as the primary one
      } else {
        // Drag only this card
        setDraggingCards([card]);
        setActiveCard(card);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // Get cards to move - use draggingCards if set, otherwise fall back to single card
    let cardsToMove: KanbanCardRow[] = [];
    if (draggingCards.length > 0) {
      cardsToMove = draggingCards;
    } else {
      // Fallback: if draggingCards wasn't set, use the active card
      const card = cards.find((c) => c.id === active.id);
      if (card) {
        cardsToMove = [card];
      }
    }

    // Clear the active card and dragging cards immediately - dropAnimation={null} prevents animation
    setActiveCard(null);
    setDraggingCards([]);

    if (!over) return;

    // Check if we're dragging a card or a column
    const isCard = cards.some((card) => card.id === active.id);
    const isColumn = columns.some((col) => col.id === active.id);

    if (isCard && cardsToMove.length > 0) {
      // Handle card drag (single or multiple)
      const targetColumnId = over.id as string;

      // Move all cards that are being dragged to the new column
      const cardsToMoveToNewColumn = cardsToMove.filter(
        (card) => card.column_id !== targetColumnId
      );

      // Move all selected cards to the new column
      cardsToMoveToNewColumn.forEach((card) => {
        moveCardMutation.mutate({ cardId: card.id, columnId: targetColumnId });
      });

      // Clear selection after moving
      if (cardsToMoveToNewColumn.length > 0) {
        setSelectedCardIds(new Set());
        setSelectedColumnId(null);
        setLastClickedCardIndex(null);
        setLastClickedColumnId(null);
      }
    } else if (isColumn) {
      // Handle column drag (reordering columns) - only in edit mode
      if (isEditMode && active.id !== over.id && onReorderColumns) {
        const oldIndex = columns.findIndex((item) => item.id === active.id);
        const newIndex = columns.findIndex((item) => item.id === over.id);
        const reorderedColumns = arrayMove(columns, oldIndex, newIndex);
        onReorderColumns(reorderedColumns);
      }
    }
  };

  const handleAddColumn = useCallback(() => {
    if (onAddColumn) {
      onAddColumn();
    }
  }, [onAddColumn]);

  const handleRenameColumn = useCallback(
    (id: string, newTitle: string) => {
      if (onRenameColumn) {
        onRenameColumn(id, newTitle);
      }
    },
    [onRenameColumn]
  );

  const handleDeleteColumn = useCallback(
    (id: string) => {
      if (onDeleteColumn) {
        onDeleteColumn(id);
      }
    },
    [onDeleteColumn]
  );

  // Selection handlers
  const handleCardSelect = useCallback(
    (
      cardId: string,
      columnId: string,
      cardIndex: number,
      event: React.MouseEvent
    ) => {
      event.stopPropagation();

      // If selecting from a different column, clear previous selection
      if (selectedColumnId !== null && selectedColumnId !== columnId) {
        setSelectedCardIds(new Set([cardId]));
        setSelectedColumnId(columnId);
        setLastClickedCardIndex(cardIndex);
        setLastClickedColumnId(columnId);
        return;
      }

      const isShiftPressed = event.shiftKey;
      const isModifierPressed = event.metaKey || event.ctrlKey;

      if (
        isShiftPressed &&
        lastClickedCardIndex !== null &&
        lastClickedColumnId === columnId
      ) {
        // Range selection: select all cards between last clicked and current
        const columnCards = cardsByColumn[columnId] || [];
        const startIndex = Math.min(lastClickedCardIndex, cardIndex);
        const endIndex = Math.max(lastClickedCardIndex, cardIndex);

        const newSelectedIds = new Set(selectedCardIds);
        for (let i = startIndex; i <= endIndex; i++) {
          if (columnCards[i]) {
            newSelectedIds.add(columnCards[i].id);
          }
        }

        setSelectedCardIds(newSelectedIds);
        setSelectedColumnId(columnId);
        setLastClickedCardIndex(cardIndex);
        setLastClickedColumnId(columnId);
      } else if (isModifierPressed) {
        // Toggle selection
        const newSelectedIds = new Set(selectedCardIds);
        if (newSelectedIds.has(cardId)) {
          newSelectedIds.delete(cardId);
          if (newSelectedIds.size === 0) {
            setSelectedColumnId(null);
            setLastClickedCardIndex(null);
            setLastClickedColumnId(null);
          }
        } else {
          newSelectedIds.add(cardId);
          setSelectedColumnId(columnId);
        }
        setSelectedCardIds(newSelectedIds);
        setLastClickedCardIndex(cardIndex);
        setLastClickedColumnId(columnId);
      } else {
        // Normal click: toggle this card individually
        const newSelectedIds = new Set(selectedCardIds);
        if (newSelectedIds.has(cardId)) {
          newSelectedIds.delete(cardId);
          if (newSelectedIds.size === 0) {
            setSelectedColumnId(null);
            setLastClickedCardIndex(null);
            setLastClickedColumnId(null);
          }
        } else {
          newSelectedIds.add(cardId);
          setSelectedColumnId(columnId);
        }
        setSelectedCardIds(newSelectedIds);
        setLastClickedCardIndex(cardIndex);
        setLastClickedColumnId(columnId);
      }
    },
    [
      selectedCardIds,
      selectedColumnId,
      lastClickedCardIndex,
      lastClickedColumnId,
      cardsByColumn,
    ]
  );

  const clearSelection = useCallback(() => {
    setSelectedCardIds(new Set());
    setSelectedColumnId(null);
    setLastClickedCardIndex(null);
    setLastClickedColumnId(null);
  }, []);

  // Empty state - show when no columns
  if (columns.length === 0) {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="bg-muted/30 flex flex-col gap-2 border-b px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="text-muted-foreground flex items-center gap-2 text-xs sm:text-sm">
              <Columns3 className="size-3 sm:size-4" />
              <span>0 columns</span>
            </div>
            <Badge variant="secondary" className="text-xs tabular-nums">
              {cards.length} cards
            </Badge>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-muted/10 flex flex-1 items-center justify-center p-4 sm:p-8">
          <div className="bg-card flex w-full max-w-md flex-col items-center rounded-2xl border-2 border-dashed p-6 text-center shadow-sm sm:p-12">
            <div className="bg-muted mb-3 rounded-full p-3 sm:mb-4 sm:p-4">
              <Columns3 className="text-muted-foreground size-6 sm:size-8" />
            </div>
            <h3 className="mb-2 text-base font-semibold sm:text-lg">
              No columns yet
            </h3>
            <p className="text-muted-foreground mb-4 text-xs sm:mb-6 sm:text-sm">
              {isEditMode
                ? "Create your first column to start organizing your workflow. You can add, rename, and reorder columns as needed."
                : "Enter edit mode to create your first column and start organizing your workflow."}
            </p>
            {isEditMode && (
              <Button
                onClick={handleAddColumn}
                size="lg"
                className="w-full sm:w-auto"
              >
                <Plus className="mr-2 size-4 sm:size-5" />
                Create First Column
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={columns.map((col) => col.id)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex h-full gap-3 overflow-x-auto p-3 sm:gap-4 sm:p-6">
          {columns.map((column, index) => {
            const isLastColumn = index === columns.length - 1;
            // Force last column to always be labeled "Done"
            const displayColumn = isLastColumn
              ? { ...column, title: "Done" }
              : column;
            return (
              <KanbanColumn
                key={column.id}
                column={displayColumn}
                cards={cardsByColumn[column.id] || []}
                onRename={handleRenameColumn}
                onDelete={handleDeleteColumn}
                isEditMode={isEditMode}
                isDraggingCard={activeCard !== null}
                hideImages={hideImages}
                usersMap={usersMap}
                isLastColumn={isLastColumn}
                selectedCardIds={selectedCardIds}
                selectedColumnId={selectedColumnId}
                onCardSelect={handleCardSelect}
              />
            );
          })}

          {/* Quick add column button at the end - only in edit mode */}
          {isEditMode && (
            <button
              onClick={handleAddColumn}
              className="border-muted-foreground/20 bg-muted/20 text-muted-foreground active:border-muted-foreground/40 active:bg-muted/40 active:text-foreground hover:border-muted-foreground/40 hover:bg-muted/40 hover:text-foreground flex h-full w-[280px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-all sm:w-[320px]"
            >
              <Plus className="size-5 sm:size-6" />
              <span className="text-xs font-medium sm:text-sm">Add Column</span>
            </button>
          )}
        </div>
      </SortableContext>

      {/* Floating bulk edit bar - shown when cards are selected */}
      {selectedCardIds.size > 0 && (
        <KanbanBulkEditBar
          selectedCardIds={selectedCardIds}
          cards={cards}
          columns={columns}
          users={users}
          onMoveCard={(cardId, columnId) =>
            moveCardMutation.mutate({ cardId, columnId })
          }
          onClearSelection={clearSelection}
          isMoving={moveCardMutation.isPending}
        />
      )}

      <DragOverlay dropAnimation={null}>
        {draggingCards.length > 0 ? (
          draggingCards.length === 1 ? (
            <div className="rotate-3 opacity-95" style={{ width: "300px" }}>
              <KanbanCardComponent
                card={draggingCards[0]}
                usersMap={usersMap}
              />
            </div>
          ) : (
            <div className="relative" style={{ width: "300px" }}>
              {draggingCards.map((card, index) => (
                <div
                  key={card.id}
                  className="absolute opacity-95"
                  style={{
                    width: "300px",
                    transform: `rotate(${(index - (draggingCards.length - 1) / 2) * 2}deg) translateY(${index * 8}px) translateX(${(index - (draggingCards.length - 1) / 2) * 4}px)`,
                    zIndex: draggingCards.length - index,
                  }}
                >
                  <KanbanCardComponent card={card} usersMap={usersMap} />
                </div>
              ))}
              <div className="bg-primary text-primary-foreground absolute -bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap shadow-lg">
                {draggingCards.length} card
                {draggingCards.length !== 1 ? "s" : ""}
              </div>
            </div>
          )
        ) : activeCard ? (
          <div className="rotate-3 opacity-95" style={{ width: "300px" }}>
            <KanbanCardComponent card={activeCard} usersMap={usersMap} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Loading skeleton for the kanban board
 */
export function KanbanBoardSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="bg-muted/30 flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-16" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Content */}
      <div className="flex flex-1 gap-3 overflow-hidden p-3 sm:gap-4 sm:p-6">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-card flex h-full w-[280px] shrink-0 flex-col rounded-xl border sm:w-[320px]"
          >
            <div className="bg-muted/30 flex items-center gap-2 border-b px-2 py-2 sm:px-3 sm:py-3">
              <Skeleton className="h-4 w-20 sm:h-5 sm:w-24" />
              <Skeleton className="h-4 w-6 rounded-full sm:h-5 sm:w-8" />
            </div>
            <div className="flex-1 space-y-2 p-2 sm:space-y-3 sm:p-3">
              {[1, 2, 3].map((j) => (
                <Skeleton
                  key={j}
                  className="h-20 w-full rounded-lg sm:h-24"
                  style={{
                    animationDelay: `${(i + j) * 100}ms`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
