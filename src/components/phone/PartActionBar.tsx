import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  approveCard,
  equipmentQuery,
  claimCard,
  markCardDone,
  queryKeys,
  sendCardBack,
  unclaimCard,
  usersQuery,
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

type Action = {
  label: string;
  /** Absent for Send back, which asks for a reason first. */
  run?: (id: string) => Promise<unknown>;
};

const CLAIM: Action = { label: "Claim", run: (id) => claimCard(id) };
const UNCLAIM: Action = { label: "Unclaim", run: unclaimCard };
const DONE: Action = { label: "Done, send to review", run: markCardDone };
const SEND_BACK: Action = { label: "Send back" };
const APPROVE: Action = { label: "Approve", run: approveCard };

/** The secondary action (if any), then the main one, per status. */
const ACTIONS: Record<string, [Action | null, Action]> = {
  [WORKFLOW_COLUMN_IDS.backlog]: [null, CLAIM],
  [WORKFLOW_COLUMN_IDS.inProgress]: [UNCLAIM, DONE],
  [WORKFLOW_COLUMN_IDS.review]: [SEND_BACK, APPROVE],
};

/**
 * The action for a part's current status, pinned at the bottom of the part
 * page: Claim in Backlog, Unclaim and Done in In Progress, Send back and
 * Approve in Review, nothing once Done.
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

  const actions = ACTIONS[card.column_id];
  if (!actions && !stationIntent) return null;
  const [secondary, main] = actions ?? [null, null];
  const choose = (chosen: Action) =>
    chosen.run
      ? action.mutate(chosen === CLAIM ? claimRun : chosen.run)
      : setAskingReason(true);
  const sendBack = () =>
    action.mutate((id) => sendCardBack(id, reason.trim()), {
      onSuccess: () => setReason(""),
      onSettled: () => setAskingReason(false),
    });

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
      {main && (
        <div className="flex gap-2">
          {secondary && (
            <Button
              variant="outline"
              className="h-12"
              disabled={action.isPending}
              onClick={() => choose(secondary)}
            >
              {secondary.label}
            </Button>
          )}
          <Button
            className={
              stationIntent && main === CLAIM
                ? "ring-status-active h-12 flex-1 ring-2 ring-offset-2"
                : "h-12 flex-1"
            }
            aria-describedby={
              stationIntent && main === CLAIM
                ? "station-claim-intent"
                : undefined
            }
            disabled={
              action.isPending ||
              (main === CLAIM &&
                stationIntent &&
                (!intendedMachine || !!equipment.error))
            }
            onClick={() => choose(main)}
          >
            {main.label}
          </Button>
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
