import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { useState, useEffect, useMemo, memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Package } from "lucide-react";
import { toast } from "sonner";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Sheet, SheetTrigger } from "~/components/ui/sheet";
import type { UserRow } from "~/server/db/types";
import {
  deleteKanbanCard,
  queryKeys,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { KanbanCardDetails } from "./KanbanCardDetails";
import { cardThumbnailUrl } from "~/lib/api/onshape";
import { cardFlags, cardMetaLine } from "~/lib/cardFace";
import type { BoardDensity } from "~/hooks/useBoardDensity";
import { cn } from "~/lib/utils";
import type { CardSelectHandler } from "~/lib/cardSelection";

interface KanbanCardProps {
  card: KanbanCardWithProcesses;
  density?: BoardDensity;
  usersMap: Map<string, UserRow>;
  /** The page's clock (`useMinuteClock`), for time in status and flags. */
  now: number;
  isSelected?: boolean;
  columnId?: string;
  /** Checkbox, shift- and cmd/ctrl-clicks select; a plain click opens details. */
  onSelect?: CardSelectHandler;
}

export const KanbanCard = memo(function KanbanCard({
  card,
  density = "compact",
  usersMap,
  now,
  isSelected = false,
  columnId = "",
  onSelect,
}: KanbanCardProps) {
  const [imageError, setImageError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const queryClient = useQueryClient();

  const imageUrl = useMemo(
    () =>
      cardThumbnailUrl({
        id: card.id,
        image_url: card.image_url,
        onshape_document_id: card.onshape_document_id,
      }),
    [card.id, card.image_url, card.onshape_document_id]
  );

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
        description: (
          <ErrorMessage
            error={error instanceof Error ? error : "Unknown error"}
          />
        ),
      });
    },
  });

  const handleDelete = () => {
    deleteCardMutation.mutate(card.id);
  };

  const meta = cardMetaLine(card, usersMap, now);
  const flags = cardFlags(card, now);
  const showImage = Boolean(imageUrl) && !imageError;
  const pictures = density === "pictures";

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Card
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          aria-label={card.title}
          onMouseDown={(e) => {
            // Shift-click selects cards, not text.
            if (onSelect && e.shiftKey) e.preventDefault();
          }}
          onClick={(e) => {
            if (!onSelect || !(e.shiftKey || e.metaKey || e.ctrlKey)) return;
            // Prevented, so the sheet trigger doesn't open details.
            e.preventDefault();
            onSelect(card.id, columnId, e);
          }}
          className={cn(
            "cursor-grab rounded-md shadow-none transition-all duration-200 active:cursor-grabbing",
            isDragging
              ? "ring-primary/20 scale-105 rotate-2 shadow-2xl ring-2"
              : isSelected
                ? "border-l-primary ring-primary/20 bg-primary/5 border-l-4 ring-2"
                : "hover:shadow-md"
          )}
        >
          <div
            className={cn(
              "grid items-center gap-x-2 gap-y-0.5 px-2 py-1.5",
              onSelect
                ? "grid-cols-[auto_auto_minmax(0,1fr)_auto]"
                : "grid-cols-[auto_minmax(0,1fr)_auto]"
            )}
          >
            {onSelect && (
              <div
                onPointerDown={(e) => {
                  // Keep a click on the checkbox from starting a drag.
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  // Space toggles the checkbox, not the card's drag or sheet.
                  e.stopPropagation();
                }}
                className="row-span-2 flex items-center"
              >
                <Checkbox
                  checked={isSelected}
                  aria-label={`Select ${card.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    // The board owns the checked state.
                    e.preventDefault();
                    onSelect(card.id, columnId, e);
                  }}
                  className="border-foreground/40 dark:border-foreground/60"
                />
              </div>
            )}
            <div
              aria-hidden="true"
              className="bg-muted row-span-2 flex size-7 items-center justify-center overflow-hidden rounded"
            >
              {showImage && !pictures ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="pointer-events-none size-full object-contain"
                  onError={() => setImageError(true)}
                />
              ) : (
                <Package className="text-muted-foreground size-4" />
              )}
            </div>
            <h3 className="truncate text-[13px] leading-tight font-semibold">
              {card.title}
            </h3>
            <span className="brand-figures justify-self-end text-xs font-bold">
              {card.quantity_to_make != null && `×${card.quantity_to_make}`}
            </span>
            <p className="text-muted-foreground truncate text-xs" title={meta}>
              {meta}
            </p>
            <span className="justify-self-end text-xs whitespace-nowrap text-[var(--emphasis)]">
              {flags.length > 0 && (
                <>
                  <AlertTriangle
                    className="mr-1 inline size-3 align-[-2px]"
                    aria-hidden="true"
                  />
                  {flags.join(" · ")}
                </>
              )}
            </span>
          </div>
          {pictures && showImage && (
            <div className="relative mx-2 mb-2 h-[120px]">
              <img
                src={imageUrl}
                alt={card.title}
                className="pointer-events-none absolute inset-0 size-full object-contain"
                onError={() => setImageError(true)}
              />
            </div>
          )}
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
