import { useState, useEffect, useMemo, memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, User, Wrench, Package } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Sheet, SheetTrigger } from "~/components/ui/sheet";
import type { UserRow } from "~/lib/db/types";
import {
  deleteKanbanCard,
  queryKeys,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { KanbanCardHeader } from "./KanbanCardHeader";
import { KanbanCardDetails } from "./KanbanCardDetails";

/**
 * Format a date string for display
 * Returns "Invalid date" for invalid date strings
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return "Invalid date";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format relative time (e.g., "2 days ago", "in 3 days")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 0) return `In ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

/**
 * Get due date urgency info
 */
function getDueDateUrgency(dateString: string): {
  variant: "destructive" | "secondary" | "outline";
  className?: string;
} {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return { variant: "secondary" };

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { variant: "destructive" }; // Overdue
  if (diffDays <= 2)
    return {
      variant: "outline",
      className:
        "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    }; // Due soon
  return { variant: "secondary" };
}

interface KanbanCardProps {
  card: KanbanCardWithProcesses;
  hideImages?: boolean;
  usersMap: Map<string, UserRow>;
  isSelected?: boolean;
  columnId?: string;
  cardIndex?: number;
  onSelect?: (
    cardId: string,
    columnId: string,
    cardIndex: number,
    event: React.MouseEvent
  ) => void;
}

export const KanbanCard = memo(function KanbanCard({
  card,
  hideImages = false,
  usersMap,
  isSelected = false,
  columnId = "",
  cardIndex = 0,
  onSelect,
}: KanbanCardProps) {
  const [imageError, setImageError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const queryClient = useQueryClient();

  const imageUrl = useMemo(() => {
    if (hideImages) return undefined;
    if (!card.image_url && !card.onshape_document_id) return undefined;
    return `/api/onshape/thumbnail?cardId=${card.id}`;
  }, [card.id, card.image_url, card.onshape_document_id, hideImages]);

  // Reset error state when imageUrl changes
  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Delete card mutation with retry logic
  const deleteCardMutation = useMutation({
    mutationFn: deleteKanbanCard,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      toast.success("Card deleted");
      setSheetOpen(false);
    },
    onError: (error) => {
      toast.error("Failed to delete card", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    },
  });

  const handleDelete = () => {
    deleteCardMutation.mutate(card.id);
  };

  const hasMeta =
    card.assignee ||
    card.machine ||
    card.due_date ||
    card.quantity_to_make ||
    (card.processes && card.processes.length > 0);

  // Get user from map instead of individual query
  const assignedUser = card.assignee ? usersMap.get(card.assignee) : undefined;

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Card
          ref={setNodeRef}
          style={style}
          className={`transition-all duration-200 ${
            isDragging
              ? "border-l-primary ring-primary/20 scale-105 rotate-2 shadow-2xl ring-2"
              : isSelected
                ? "border-l-primary ring-primary/20 bg-primary/5 border-l-4 ring-2"
                : "hover:shadow-md"
          }`}
        >
          <div className="flex flex-col items-start justify-between gap-2">
            <KanbanCardHeader
              title={card.title}
              attributes={attributes}
              listeners={listeners}
              isSelected={isSelected}
              onCheckboxClick={
                onSelect
                  ? (e) => onSelect(card.id, columnId, cardIndex, e)
                  : undefined
              }
            />
            <div className="flex w-full justify-center px-2">
              {/* Card Image - Clickable to open drawer */}
              {imageUrl && !imageError && !hideImages && (
                <button
                  className="w-full px-2.5 pb-2 text-left sm:px-3"
                  aria-label="View card details"
                >
                  <div className="relative w-full" style={{ height: "120px" }}>
                    <img
                      src={imageUrl}
                      alt={card.title}
                      className="pointer-events-none absolute inset-0 size-full object-contain"
                      onError={() => setImageError(true)}
                    />
                  </div>
                </button>
              )}
            </div>

            {/* Card Meta */}
            {hasMeta && (
              <CardContent className="flex flex-wrap gap-1.5 px-2.5 pt-0 pb-2.5 sm:px-3 sm:pb-3">
                {card.assignee && (
                  <Badge
                    variant="secondary"
                    className="bg-primary/5 gap-1 text-xs font-normal"
                  >
                    <User className="size-3" />
                    {assignedUser?.name || "??"}
                  </Badge>
                )}
                {card.machine && (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-blue-500/10 text-xs font-normal text-blue-700 dark:text-blue-400"
                  >
                    <Wrench className="size-3" />
                    {card.machine}
                  </Badge>
                )}
                {card.quantity_to_make && (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-green-500/10 text-xs font-normal text-green-700 dark:text-green-400"
                  >
                    <Package className="size-3" />
                    Qty: {card.quantity_to_make}
                  </Badge>
                )}
                {card.due_date &&
                  (() => {
                    const urgency = getDueDateUrgency(card.due_date);
                    return (
                      <Badge
                        variant={urgency.variant}
                        className={`gap-1 text-xs font-normal ${urgency.className || ""}`}
                      >
                        <Calendar className="size-3" />
                        {formatRelativeTime(card.due_date)}
                      </Badge>
                    );
                  })()}
                {card.processes &&
                  card.processes.length > 0 &&
                  card.processes.map((process) => (
                    <Badge
                      key={process.id}
                      variant="secondary"
                      className="gap-1 bg-purple-500/10 text-xs font-normal text-purple-700 dark:text-purple-400"
                    >
                      {process.name}
                    </Badge>
                  ))}
              </CardContent>
            )}
          </div>
        </Card>
      </SheetTrigger>

      <KanbanCardDetails
        card={card}
        imageUrl={imageUrl}
        deleteCardMutation={deleteCardMutation}
        onDelete={handleDelete}
        usersMap={usersMap}
      />
    </Sheet>
  );
});
