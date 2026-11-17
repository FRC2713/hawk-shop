import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  assignCardsToMachine,
  equipmentQuery,
  kanbanCardsQuery,
  needsMaintenance,
  queryKeys,
  usersQuery,
  type EquipmentWithProcesses,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { machineRefusal } from "~/lib/machineQueue";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";

type Process = { id: string; name: string };

/** Processes every one of `cards` has, by name. */
function sharedProcesses(cards: KanbanCardWithProcesses[]): Process[] {
  const [first, ...rest] = cards.map((card) => card.processes ?? []);
  return (first ?? [])
    .filter((process) =>
      rest.every((others) => others.some((other) => other.id === process.id))
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Machines that make every selected part, maintenance or not. A machine under
 * maintenance is listed so the mentor sees why it isn't offered, but disabled.
 */
function capableMachines(
  equipment: EquipmentWithProcesses[],
  cards: KanbanCardWithProcesses[]
) {
  return equipment
    .filter((machine) =>
      cards.every((card) => !machineRefusal({ ...machine, status: null }, card))
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The bottom sheet a mentor assigns selected backlog parts from: "Any
 * <process>" (back to the process queue) and each machine that can make them
 * all, with how many parts are already queued on it and what it's doing.
 */
export function AssignSheet({
  cards,
  open,
  onOpenChange,
  onAssigned,
}: {
  cards: KanbanCardWithProcesses[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: allCards = [] } = useQuery(kanbanCardsQuery());
  const { data: equipment = [] } = useQuery(equipmentQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const assign = useMutation({
    mutationFn: (machineId: string | null) =>
      assignCardsToMachine(
        cards.map((card) => card.id),
        machineId
      ),
    onSuccess: (_, machineId) => {
      const target = machineId
        ? (equipment.find((machine) => machine.id === machineId)?.name ??
          "the machine")
        : "their process queue";
      toast.success(`Assigned ${plural(cards.length, "part")} to ${target}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      onAssigned();
    },
  });

  const backlog = allCards.filter(
    (card) => card.column_id === WORKFLOW_COLUMN_IDS.backlog
  );
  const process = sharedProcesses(cards)[0];
  const machines = capableMachines(equipment, cards);
  const nameOf = (subject: string) =>
    users.find((user) => user.onshape_user_id === subject)?.name ?? subject;
  const activity = (machine: EquipmentWithProcesses) => {
    if (needsMaintenance(machine)) return "Needs maintenance";
    const running = allCards.find(
      (card) =>
        card.column_id === WORKFLOW_COLUMN_IDS.inProgress &&
        card.machine_id === machine.id
    );
    if (!running) return "Idle";
    return running.assignee
      ? `Running · ${nameOf(running.assignee)}`
      : "Running";
  };
  const title = `Assign ${plural(cards.length, "part")}`;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) assign.reset();
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        className="bg-card max-h-[85dvh] gap-2 overflow-y-auto rounded-t-2xl px-4 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] [&>button:last-child]:hidden"
      >
        <span
          aria-hidden="true"
          className="bg-border h-1 w-10 self-center rounded-full"
        />
        <div className="flex items-center justify-between">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          <SheetClose className="text-status-active min-h-11 px-2 font-semibold">
            Cancel
          </SheetClose>
        </div>
        <SheetDescription className="text-xs">
          Numbers are parts already queued.
        </SheetDescription>

        <Choice
          name={process ? `Any ${process.name}` : "No machine"}
          detail={
            process
              ? `Whoever runs ${process.name} claims them first`
              : "Back to each part's process queue"
          }
          count={
            process
              ? backlog.filter(
                  (card) =>
                    !card.machine_id &&
                    card.processes?.some((other) => other.id === process.id)
                ).length
              : undefined
          }
          highlight
          disabled={assign.isPending}
          onSelect={() => assign.mutate(null)}
        />
        {machines.map((machine) => (
          <Choice
            key={machine.id}
            name={machine.name}
            detail={activity(machine)}
            warn={needsMaintenance(machine)}
            count={
              backlog.filter((card) => card.machine_id === machine.id).length
            }
            disabled={needsMaintenance(machine) || assign.isPending}
            onSelect={() => assign.mutate(machine.id)}
          />
        ))}
        {machines.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No machine can make all of these parts.
          </p>
        )}
        {assign.isPending && (
          <p role="status" className="text-muted-foreground text-sm">
            Assigning...
          </p>
        )}
        {assign.error && <ErrorMessage error={assign.error} />}
      </SheetContent>
    </Sheet>
  );
}

function Choice({
  name,
  detail,
  count,
  highlight,
  warn,
  disabled,
  onSelect,
}: {
  name: string;
  detail: ReactNode;
  count?: number;
  highlight?: boolean;
  warn?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-choice
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "bg-muted text-foreground flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left disabled:opacity-50",
        highlight && "border-status-active"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{name}</span>
        <span
          className={cn(
            "block text-xs",
            warn ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {detail}
        </span>
      </span>
      {count !== undefined && (
        <span className="brand-figures font-bold">{count}</span>
      )}
    </button>
  );
}
