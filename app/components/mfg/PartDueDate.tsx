import { useEffect, useState, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Calendar } from "~/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { partActions, queryKeys } from "~/lib/api";
import type { KanbanCardRow } from "~/lib/db/types";

interface PartDueDateProps {
  card: KanbanCardRow;
}

/**
 * Component to display and edit the due date for a card
 */
/**
 * Parse a date string (ISO 8601) as a local date
 * Dates like "2024-01-15" should be treated as local dates, not UTC
 */
function parseLocalDate(dateString: string): Date {
  // If it's just a date (YYYY-MM-DD), parse it as local time to avoid timezone issues
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  // If it has time information, parse it normally
  return parseISO(dateString);
}

export function PartDueDate({ card }: PartDueDateProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const updateDueDate = useMutation({
    mutationFn: (dueDate: string) =>
      partActions.updateDueDate(card.id, dueDate),
    onSuccess: (result) => {
      if (!result.success) return;
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    },
  });

  const isSubmitting = updateDueDate.isPending;
  // A rejection reads the same as a rejected update to the user.
  const result =
    updateDueDate.data ??
    (updateDueDate.error
      ? { success: false, error: "Failed to update due date" }
      : null);

  // Parse the card's dueDate only when it actually changes
  const cardDueDate = useMemo(() => {
    if (!card.due_date) return undefined;
    try {
      return parseLocalDate(card.due_date);
    } catch (e) {
      console.error("Error parsing due date:", card.due_date, e);
      return undefined;
    }
  }, [card.due_date]);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    cardDueDate
  );
  const lastSubmittedDateRef = useRef<string | null>(null);

  // Update selectedDate only when cardDueDate actually changes (but not during user edits)
  useEffect(() => {
    // Don't update if we just submitted a date (let it come back from the server)
    if (lastSubmittedDateRef.current !== null) {
      const submittedDateStr = lastSubmittedDateRef.current;
      const cardDateStr = cardDueDate ? format(cardDueDate, "yyyy-MM-dd") : "";

      // Only update if the card date matches what we submitted (update complete)
      // Handle both cases: clearing (empty string) and setting a date
      if (submittedDateStr === cardDateStr) {
        lastSubmittedDateRef.current = null;
      } else {
        // Still waiting for the update to propagate
        return;
      }
    }

    if (isSubmitting) {
      return;
    }

    // Compare dates by their date-only values to avoid unnecessary updates
    const currentDateStr = selectedDate
      ? format(selectedDate, "yyyy-MM-dd")
      : "";
    const cardDateStr = cardDueDate ? format(cardDueDate, "yyyy-MM-dd") : "";

    if (currentDateStr !== cardDateStr) {
      setSelectedDate(cardDueDate);
    }
  }, [cardDueDate, selectedDate, isSubmitting]);

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
    const isoDate = format(date, "yyyy-MM-dd");
    // Track what we're submitting so the sync effect above can tell a stale
    // card prop from one that already reflects this write.
    lastSubmittedDateRef.current = isoDate;
    updateDueDate.mutate(isoDate);
  };

  const handleClearDate = () => {
    setSelectedDate(undefined);
    // An empty string is how the action clears the date.
    lastSubmittedDateRef.current = "";
    updateDueDate.mutate("");
  };

  return (
    <div className="flex flex-row flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 w-fit justify-start text-left font-normal",
              !selectedDate && "text-muted-foreground"
            )}
            disabled={isSubmitting}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selectedDate ? (
              format(selectedDate, "PPP")
            ) : (
              <span>Set due date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            disabled={isSubmitting}
          />
          {selectedDate && (
            <div className="border-t p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleClearDate}
                disabled={isSubmitting}
              >
                Clear date
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {result && !result.success && result.error && (
        <p className="text-destructive text-xs">{result.error}</p>
      )}
    </div>
  );
}
