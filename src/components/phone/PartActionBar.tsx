import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { CircleCheck } from "lucide-react";
import {
  equipmentQuery,
  claimCard,
  queryKeys,
  usersQuery,
  type KanbanCardWithHistory,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { isConflict, memberName } from "~/lib/phoneParts";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
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
import { cn } from "~/lib/utils";

import {
  WORKFLOW_ACTIONS,
  workflowActionsFor,
  type WorkflowAction,
} from "~/lib/workflowActions";

/**
 * The action for a part's current status, pinned at the bottom of the part
 * page: Claim in Backlog, Unclaim and Done in In Progress, Send back and
 * Approve in Review. A Done part gets a read-only line saying who approved
 * it and when, from its status history when the card carries one.
 *
 * A conflict (409) stays in the bar with the server's reason, and every
 * outcome refetches the part, so a lost claim names whoever won it
 * (`viewerId`, the signed-in member's Suite subject, tells them apart).
 */
export function PartActionBar({
  card,
  viewerId,
}: {
  card: KanbanCardWithProcesses;
  viewerId: string;
}) {
  // Keep URL intent through Suite recovery, but never turn navigation into a mutation.
  const [claimMachineId, setClaimMachineId] = useState<
    string | null | undefined
  >();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("intent") === "claim")
      setClaimMachineId(
        params.getAll("machineId").length === 1
          ? params.get("machineId") || null
          : null
      );
  }, []);
  const stationIntent = claimMachineId !== undefined;
  const equipment = useQuery({ ...equipmentQuery(), enabled: stationIntent });
  const intendedMachine = equipment.data?.find(
    (machine) => machine.id === claimMachineId
  );
  const claimRun = useCallback(
    (id: string) =>
      claimCard(
        id,
        stationIntent && claimMachineId ? { machineId: claimMachineId } : {}
      ),
    [stationIntent, claimMachineId]
  );
  const queryClient = useQueryClient();
  const { data: users = [] } = useQuery(usersQuery());
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState("");
  const action = useMutation({
    mutationFn: (run: (id: string) => Promise<unknown>) => run(card.id),
    onError: (error) => {
      if (!isConflict(error))
        toast.error("That didn't work", {
          description: <ErrorMessage error={error} cardId={card.id} />,
        });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() }),
  });

  let conflict = isConflict(action.error) ? action.error.message : null;
  if (
    conflict &&
    action.variables === claimRun &&
    card.assignee &&
    card.assignee !== viewerId
  )
    conflict = `${memberName(users, card.assignee)} already claimed this part`;

  const actions = workflowActionsFor(card);
  if (actions.length === 0 && !stationIntent)
    return card.column_id === WORKFLOW_COLUMN_IDS.done ? (
      <DoneLine card={card} />
    ) : null;
  const choose = (chosen: WorkflowAction) => {
    if (chosen === "sendBack") setAskingReason(true);
    else
      action.mutate(
        chosen === "claim"
          ? claimRun
          : (id) => WORKFLOW_ACTIONS[chosen].request(id)
      );
  };
  const sendBack = () =>
    action.mutate(
      (id) => WORKFLOW_ACTIONS.sendBack.request(id, reason.trim()),
      {
        onSuccess: () => setReason(""),
        onSettled: () => setAskingReason(false),
      }
    );

  return (
    <div className="flex w-full flex-col gap-2">
      {stationIntent && (
        <div
          id="station-claim-intent"
          role="status"
          className="border-status-active rounded-lg border-l-4 px-3 py-2 text-sm"
        >
          {card.column_id !== WORKFLOW_COLUMN_IDS.backlog ? (
            <p>
              This part has already moved out of Backlog. Check its current
              status.
            </p>
          ) : intendedMachine ? (
            <p>
              Claim at {intendedMachine.name}. Tap Claim to make this part as
              yourself.
            </p>
          ) : (
            <p>
              {equipment.isPending && claimMachineId
                ? "Loading station machine…"
                : "This station link has no available machine. Open the part again or scan a new code."}
            </p>
          )}
          {equipment.error && <ErrorMessage error={equipment.error} />}
          <a
            className="underline"
            href={`/parts/${encodeURIComponent(card.id)}`}
          >
            Open part without station claim
          </a>
        </div>
      )}
      {conflict && (
        <p role="alert" className="text-sm font-semibold">
          {conflict}
        </p>
      )}
      {actions.length > 0 && (
        <div className="flex gap-2 lg:justify-end">
          {actions.map((chosen) => (
            <Button
              key={chosen}
              variant={WORKFLOW_ACTIONS[chosen].primary ? "default" : "outline"}
              className={cn(
                "h-12",
                // The primary action takes most of the bar; the other one
                // (Unclaim, Send back) stays as wide as its label.
                // On desktop the primary action sizes to its label too, so
                // it doesn't become a banner across a wide column.
                WORKFLOW_ACTIONS[chosen].primary
                  ? "flex-1 lg:flex-none lg:px-6"
                  : "flex-none px-5",
                stationIntent &&
                  chosen === "claim" &&
                  "ring-status-active ring-2 ring-offset-2"
              )}
              aria-describedby={
                stationIntent && chosen === "claim"
                  ? "station-claim-intent"
                  : undefined
              }
              disabled={
                action.isPending ||
                (chosen === "claim" &&
                  stationIntent &&
                  (!intendedMachine || !!equipment.error))
              }
              onClick={() => choose(chosen)}
            >
              {WORKFLOW_ACTIONS[chosen].label}
            </Button>
          ))}
        </div>
      )}

      <Dialog open={askingReason} onOpenChange={setAskingReason}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (reason.trim()) sendBack();
            }}
          >
            <DialogHeader>
              <DialogTitle>Send this part back?</DialogTitle>
              <DialogDescription>
                The reason stays on the part for whoever makes it next.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`send-back-reason-${card.id}`}>Reason</Label>
              <Textarea
                id={`send-back-reason-${card.id}`}
                value={reason}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setAskingReason(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={!reason.trim() || action.isPending}
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

/** "Done · approved by Alex Chen, Nov 9", from the move into Done. */
function DoneLine({ card }: { card: KanbanCardWithProcesses }) {
  const history = (card as Partial<KanbanCardWithHistory>).status_history;
  const approval = history
    ?.filter((entry) => entry.to_column_id === WORKFLOW_COLUMN_IDS.done)
    .at(-1);
  return (
    <p className="flex min-h-12 w-full items-center gap-2 text-sm font-semibold">
      <CircleCheck
        aria-hidden="true"
        className="text-status-active size-5 flex-none"
      />
      <span>
        Done
        {approval &&
          ` · approved by ${approval.actor_name}, ${format(parseISO(approval.moved_at), "MMM d")}`}
      </span>
    </p>
  );
}
