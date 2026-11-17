import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  approveCard,
  claimCard,
  markCardDone,
  queryKeys,
  sendCardBack,
  unclaimCard,
} from "~/lib/api";
import { workflowActionsFor, type WorkflowAction } from "~/lib/workflowActions";
import { cn } from "~/lib/utils";

const LABELS: Record<WorkflowAction, string> = {
  claim: "Claim",
  unclaim: "Unclaim",
  done: "Done, send to review",
  approve: "Approve",
  sendBack: "Send back",
};

const PRIMARY: WorkflowAction[] = ["claim", "done", "approve"];

/**
 * The buttons for a part's next workflow step: Claim, Unclaim, Done, Approve
 * or Send back, whichever its status allows. Send back asks for a reason
 * first. A refusal (say, someone else claimed it first) shows the server's
 * reason in a toast; either way the board's cards are refetched.
 */
export function WorkflowActions({
  card,
  className,
}: {
  card: {
    id: string;
    title: string;
    column_id: string;
    assignee: string | null;
  };
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const mutation = useMutation({
    mutationFn: (action: WorkflowAction) => {
      switch (action) {
        case "claim":
          return claimCard(card.id);
        case "unclaim":
          return unclaimCard(card.id);
        case "done":
          return markCardDone(card.id);
        case "approve":
          return approveCard(card.id);
        case "sendBack":
          return sendCardBack(card.id, reason.trim());
      }
    },
    onSuccess: (_card, action) => {
      if (action === "sendBack") {
        setSendBackOpen(false);
        setReason("");
      }
    },
    onError: (error, action) =>
      toast.error(`Couldn't ${LABELS[action].toLowerCase()} "${card.title}"`, {
        description: error.message,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() }),
  });

  const actions = workflowActionsFor(card);
  if (actions.length === 0) return null;

  return (
    <div className={cn("flex gap-2", className)}>
      {actions.map((action) => (
        <Button
          key={action}
          type="button"
          size="sm"
          className="flex-1"
          variant={PRIMARY.includes(action) ? "default" : "outline"}
          disabled={mutation.isPending}
          onClick={() =>
            action === "sendBack"
              ? setSendBackOpen(true)
              : mutation.mutate(action)
          }
        >
          {LABELS[action]}
        </Button>
      ))}
      <Dialog open={sendBackOpen} onOpenChange={setSendBackOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim()) mutation.mutate("sendBack");
            }}
          >
            <DialogHeader>
              <DialogTitle>Send back "{card.title}"</DialogTitle>
              <DialogDescription>
                The reason is kept on the part for whoever makes it next.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={reasonId}>Why is it going back?</Label>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSendBackOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!reason.trim() || mutation.isPending}
              >
                Send back
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
