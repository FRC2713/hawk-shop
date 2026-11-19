import type { ReactNode } from "react";
import { Wrench } from "lucide-react";
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
import { machineQueue, machineRefusal } from "~/lib/machineQueue";
import {
  byMachineName,
  machineActivity,
  plural,
  runningOn,
} from "~/lib/phoneParts";
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
    .sort(byMachineName);
}

/**
 * The bottom sheet a mentor assigns selected backlog parts from: back to the
 * process queues ("Any <process>" when the parts share exactly one process)
 * and each machine that can make them all, with its queue size (the same
 * `machineQueue` count as Shop and Next up) and what it's doing.
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
  const shared = sharedProcesses(cards);
  // "Any <process>" only names a process when it is the one they all share.
  const process = shared.length === 1 ? shared[0] : undefined;
  const machines = capableMachines(equipment, cards);
  const now = Date.now();
  const activity = (machine: EquipmentWithProcesses) =>
    machineActivity(machine, runningOn(machine, allCards), users, now).text;
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
        className="bg-card max-h-[85dvh] gap-2 overflow-y-auto rounded-t-2xl px-4 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:rounded-2xl lg:border lg:pt-4 lg:pb-5 [&>button:last-child]:hidden"
      >
        <span
          aria-hidden="true"
          className="bg-border h-1 w-10 self-center rounded-full lg:hidden"
        />
        <div className="flex items-center justify-between">
          <SheetTitle className="font-heading text-xl font-semibold">
            {title}
          </SheetTitle>
          <SheetClose className="text-link min-h-11 px-2 font-semibold">
            Cancel
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">
          Send the parts back to their process queue or to one machine. Each
          choice shows how many parts are already queued there.
        </SheetDescription>

        <Choice
          name={process ? `Any ${process.name}` : "Back to process queues"}
          detail={
            process
              ? `Whoever runs ${process.name} claims them first`
              : "Each part waits in its own process queue"
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
          disabled={assign.isPending}
          onSelect={() => assign.mutate(null)}
        />
        {machines.length > 0 && (
          <p aria-hidden="true" className="eyebrow pt-2">
            Or one machine
          </p>
        )}
        {machines.map((machine) =>
          needsMaintenance(machine) ? (
            <Choice
              key={machine.id}
              name={machine.name}
              detail={
                <>
                  <span className="text-emphasis flex items-center gap-1 font-semibold">
                    <Wrench className="size-3.5 shrink-0" aria-hidden="true" />
                    Needs maintenance
                  </span>
                  {machine.maintenance_note && (
                    <span className="text-muted-foreground line-clamp-1">
                      {machine.maintenance_note}
                    </span>
                  )}
                </>
              }
              down
              disabled
              onSelect={() => {}}
            />
          ) : (
            <Choice
              key={machine.id}
              name={machine.name}
              detail={activity(machine)}
              count={machineQueue(machine, allCards).length}
              disabled={assign.isPending}
              onSelect={() => assign.mutate(machine.id)}
            />
          )
        )}
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
  down,
  disabled,
  onSelect,
}: {
  name: string;
  detail: ReactNode;
  count?: number;
  /** A machine under maintenance: shown with its reason, never faded. */
  down?: boolean;
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
        "bg-muted text-foreground flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-left",
        down
          ? "disabled:cursor-not-allowed"
          : "hover:border-foreground/40 transition-colors disabled:opacity-50"
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn("block font-semibold", down && "text-muted-foreground")}
        >
          {name}
        </span>
        <span className="text-muted-foreground block text-xs">{detail}</span>
      </span>
      {down ? (
        <span className="text-foreground rounded-full border px-2 py-0.5 text-xs font-semibold">
          Down
        </span>
      ) : (
        count !== undefined && (
          <span className="shrink-0 text-right leading-tight">
            <span className="brand-figures block font-bold">{count}</span>
            <span className="text-muted-foreground block text-[11px]">
              queued
            </span>
          </span>
        )
      )}
    </button>
  );
}
