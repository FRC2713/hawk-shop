import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { queryKeys, updateKanbanCard } from "~/lib/api";

interface SubmitterNotesProps {
  cardId: string;
  notes: string | null;
  submitterName: string;
}

/**
 * The submitter's manufacturing notes (walls, tolerances, finish), stored in
 * the card's `content`. Any member can edit them; edits are not status
 * changes.
 */
export function SubmitterNotes({
  cardId,
  notes,
  submitterName,
}: SubmitterNotesProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const headingId = `notes-${cardId}`;
  const save = useMutation({
    mutationFn: (content: string) => updateKanbanCard(cardId, { content }),
    onSuccess: () => {
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    },
    onError: (error) =>
      toast.error("Failed to save notes", {
        description: <ErrorMessage error={error} cardId={cardId} />,
      }),
  });

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 id={headingId} className="font-heading text-base font-semibold">
          Notes from {submitterName}
        </h4>
        {draft === null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDraft(notes ?? "")}
          >
            {notes ? "Edit" : "Add notes"}
          </Button>
        )}
      </div>
      {draft !== null ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(draft);
          }}
        >
          <Textarea
            aria-labelledby={headingId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Walls, tolerances, finish"
            rows={4}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(null)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save notes"}
            </Button>
          </div>
        </form>
      ) : notes ? (
        <div className="callout callout-teal">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{notes}</p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No notes.</p>
      )}
    </section>
  );
}
