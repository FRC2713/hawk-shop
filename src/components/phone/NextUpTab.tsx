import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import {
  claimCard,
  equipmentQuery,
  kanbanCardsQuery,
  machineQueueQuery,
  needsMaintenance,
  queryKeys,
  usersQuery,
  type EquipmentWithProcesses,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { cardOnshapeUrl } from "~/lib/onshapeLinks";
import { partHref } from "~/lib/phone";
import {
  byMachineName,
  dueLabel,
  isConflict,
  type Member,
  machineActivity,
  memberName,
  runningOn,
} from "~/lib/phoneParts";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import { loadState } from "./LoadState";
import { PartActionBar } from "./PartActionBar";
import { PartList, PartRow } from "./PartRow";

/**
 * The Next up tab: the operator's machine for the day, the part they're
 * making there with Unclaim and Done, and the machine's queue with Claim on
 * each row. The machine is remembered per browser for the local day
 * (`useMachineForToday`).
 */
export function NextUpTab({ viewerId }: { viewerId: string }) {
  const [machineId, setMachineId] = useMachineForToday();
  const [changing, setChanging] = useState(false);
  const equipment = useQuery(equipmentQuery());
  const cards = useQuery(kanbanCardsQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const machine = equipment.data?.find((item) => item.id === machineId);

  // `undefined` until the browser's choice is read, so the server render and
  // hydration don't flash the picker at an operator who already chose. The
  // picker also waits for cards: without them every machine reads "Idle".
  const pending =
    machineId === undefined ? (
      <p role="status" className="text-muted-foreground">
        Loading...
      </p>
    ) : (
      loadState(machine ? [equipment] : [equipment, cards], "Loading...")
    );
  if (pending || !equipment.data) return <TabShell>{pending}</TabShell>;

  const choose = (id: string) => {
    setMachineId(id);
    setChanging(false);
  };
  const picker = (current?: string) => (
    <MachinePicker
      machines={equipment.data}
      cards={cards.data ?? []}
      users={users}
      viewerId={viewerId}
      current={current}
      onChoose={choose}
    />
  );

  if (!machine)
    return (
      <TabShell>
        <p className="font-semibold">Which machine are you on?</p>
        {picker()}
      </TabShell>
    );

  return (
    <TabShell
      machineButton={
        <Button
          variant="outline"
          className="min-h-11"
          aria-label={`Machine: ${machine.name}. Change`}
          onClick={() => setChanging(true)}
        >
          {machine.name}
          <ChevronDown aria-hidden="true" />
        </Button>
      }
    >
      <MachineWork machine={machine} viewerId={viewerId} />
      <Dialog open={changing} onOpenChange={setChanging}>
        <DialogContent className="p-4">
          <DialogTitle>Change machine</DialogTitle>
          <DialogDescription>Which machine are you on?</DialogDescription>
          {picker(machine.id)}
        </DialogContent>
      </Dialog>
    </TabShell>
  );
}

function TabShell({
  machineButton,
  children,
}: {
  machineButton?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl">Next up</h1>
        {machineButton}
      </div>
      {children}
    </main>
  );
}

/** Every machine with its processes and what it's doing now. */
function MachinePicker({
  machines,
  cards,
  users,
  viewerId,
  current,
  onChoose,
}: {
  machines: EquipmentWithProcesses[];
  cards: KanbanCardWithProcesses[];
  users: Member[];
  viewerId: string;
  current?: string;
  onChoose: (id: string) => void;
}) {
  if (!machines.length)
    return (
      <p className="text-muted-foreground">
        No machines yet. Add one on the Equipment page.
      </p>
    );
  const now = Date.now();
  return (
    <ul
      aria-label="Machines"
      className="bg-card overflow-hidden rounded-xl border"
    >
      {[...machines].sort(byMachineName).map((machine) => {
        const activity = machineActivity(
          machine,
          runningOn(machine, cards),
          users,
          now,
          viewerId
        );
        return (
          <li key={machine.id} className="not-last:border-b">
            <button
              type="button"
              aria-current={machine.id === current ? "true" : undefined}
              onClick={() => onChoose(machine.id)}
              className="hover:bg-muted aria-[current]:bg-muted flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <span className="min-w-0">
                <span className="block font-semibold break-words">
                  {machine.name}
                </span>
                {!!machine.processes?.length && (
                  <span className="text-muted-foreground block text-xs">
                    {machine.processes
                      .map((process) => process.name)
                      .join(", ")}
                  </span>
                )}
              </span>
              <span
                className={
                  activity.maintenance
                    ? "text-destructive max-w-[50%] shrink-0 text-right text-xs font-semibold"
                    : "text-muted-foreground max-w-[50%] shrink-0 text-right text-xs"
                }
              >
                {activity.text}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The part the operator is making on `machine`, then its queue. */
function MachineWork({
  machine,
  viewerId,
}: {
  machine: EquipmentWithProcesses;
  viewerId: string;
}) {
  const queryClient = useQueryClient();
  const cards = useQuery(kanbanCardsQuery());
  const queue = useQuery(machineQueueQuery(machine.id));
  const { data: users = [] } = useQuery(usersQuery());

  const claim = useMutation({
    mutationFn: (card: KanbanCardWithProcesses) =>
      claimCard(card.id, { machineId: machine.id }),
    onSuccess: (card) => toast.success(`Claimed ${card.title}`),
    onError: (error, card) =>
      toast.error(isConflict(error) ? error.message : "Failed to claim part", {
        description: <ErrorMessage error={error} cardId={card.id} />,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() }),
  });

  // Parts the operator holds here first, then any they hold elsewhere.
  const making = (cards.data ?? [])
    .filter(
      (card) =>
        card.column_id === WORKFLOW_COLUMN_IDS.inProgress &&
        card.assignee === viewerId
    )
    .sort(
      (a, b) =>
        Number(b.machine_id === machine.id) -
        Number(a.machine_id === machine.id)
    );
  const waiting = queue.data ?? [];
  const summary = [
    machine.processes?.map((process) => process.name).join(", "),
    queue.data && `${waiting.length} waiting`,
  ].filter(Boolean);

  return (
    <>
      {summary.length > 0 && (
        <p className="text-muted-foreground -mt-3 text-sm">
          {summary.join(" · ")}
        </p>
      )}
      {needsMaintenance(machine) && (
        <p role="note" className="bg-muted rounded-lg p-3 text-sm">
          {machine.name} needs maintenance
          {machine.maintenance_note ? `: ${machine.maintenance_note}` : "."}
        </p>
      )}

      {making.map((card) => (
        <WorkingOn
          key={card.id}
          card={card}
          submitter={memberName(users, card.created_by)}
          sop={
            machine.id === card.machine_id
              ? machine.documentation_url
              : undefined
          }
          machineName={card.linked_machine?.name ?? null}
          actions={<PartActionBar card={card} viewerId={viewerId} />}
        />
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-base">Waiting for {machine.name}</h2>
        {loadState([queue], "Loading queue...") ??
          (waiting.length === 0 ? (
            <p className="text-muted-foreground">
              Nothing waiting for {machine.name}.
            </p>
          ) : (
            <PartList label={`Waiting for ${machine.name}`}>
              {waiting.map((card) => (
                <PartRow
                  key={card.id}
                  card={card}
                  detail={<QueueDetail card={card} machine={machine} />}
                  trailing={
                    <Button
                      variant="outline"
                      className="min-h-11 px-4"
                      aria-label={`Claim ${card.title}`}
                      disabled={claim.isPending}
                      onClick={() => claim.mutate(card)}
                    >
                      Claim
                    </Button>
                  }
                />
              ))}
            </PartList>
          ))}
      </section>
    </>
  );
}

function WorkingOn({
  card,
  submitter,
  sop,
  machineName,
  actions,
}: {
  card: KanbanCardWithProcesses;
  submitter: string | null;
  sop: string | null | undefined;
  machineName: string | null;
  /** Unclaim and Done, the part page's action bar. */
  actions: ReactNode;
}) {
  const onshapeUrl = cardOnshapeUrl(card);
  const byline = [
    card.onshape_material,
    card.onshape_version_name,
    card.project?.name,
  ].filter(Boolean);
  return (
    <section
      aria-label="Working on"
      className="bg-card border-l-primary flex flex-col gap-3 rounded-xl border border-l-4 p-3.5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-primary text-xs font-semibold">
            You're making{machineName ? ` on ${machineName}` : ""}
          </p>
          <h2 className="text-lg leading-snug break-words">{card.title}</h2>
          {byline.length > 0 && (
            <p className="text-muted-foreground text-sm">
              {byline.join(" · ")}
            </p>
          )}
        </div>
        {card.quantity_to_make != null && (
          <p className="shrink-0 text-right">
            <span
              data-fact="Quantity"
              className="brand-figures block text-2xl font-bold"
            >
              ×{card.quantity_to_make}
            </span>
            <span className="text-muted-foreground text-xs">to make</span>
          </p>
        )}
      </div>
      {card.content && (
        <p className="bg-muted rounded-lg px-3 py-2.5 text-sm break-words whitespace-pre-wrap">
          <span className="font-semibold">
            Note from {submitter ?? "the submitter"}:
          </span>{" "}
          {card.content}
        </p>
      )}
      {actions}
      <div className="flex flex-wrap gap-x-4 text-sm">
        <a href={partHref(card.id)} className="flex min-h-11 items-center">
          Part details
        </a>
        {sop && (
          <a
            href={sop}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center"
          >
            {machineName ? `${machineName} SOP` : "SOP"}
          </a>
        )}
        {onshapeUrl && (
          <a
            href={onshapeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center"
          >
            Open in Onshape
          </a>
        )}
      </div>
    </section>
  );
}

/**
 * Material, quantity and due date (overdue ones marked), and "any <process>"
 * for a part waiting in the process queue rather than assigned to this
 * machine.
 */
function QueueDetail({
  card,
  machine,
}: {
  card: KanbanCardWithProcesses;
  machine: EquipmentWithProcesses;
}) {
  const due = card.due_date ? dueLabel(card.due_date) : null;
  const facts = [
    card.onshape_material,
    card.quantity_to_make != null && `×${card.quantity_to_make}`,
    due?.text,
  ].filter(Boolean);
  const process =
    card.machine_id === null
      ? (card.processes ?? []).find((process) =>
          machine.processes?.some((own) => own.id === process.id)
        )
      : undefined;
  return (
    <span className="flex flex-col">
      {facts.length > 0 && (
        <span
          data-overdue={due?.overdue ? "" : undefined}
          className={due?.overdue ? "text-destructive font-semibold" : ""}
        >
          {facts.join(" · ")}
        </span>
      )}
      {process && (
        <span className="text-status-active">{`any ${process.name}`}</span>
      )}
    </span>
  );
}

const MACHINE_KEY = "hawk-shop:next-up-machine";
const machineListeners = new Set<() => void>();
/** Where the choice lives when the browser refuses storage (private mode). */
let unsavedChoice: string | null = null;

/** Today in the browser's time zone, as yyyy-MM-dd. */
const localDay = () => format(new Date(), "yyyy-MM-dd");

/** The stored machine id when it was chosen today; an older choice lapses. */
function choiceForToday(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const { machineId, day } = JSON.parse(stored);
    return day === localDay() && typeof machineId === "string"
      ? machineId
      : null;
  } catch {
    // A bare id saved before the choice carried its day.
    return null;
  }
}

function readMachine(): string | null {
  try {
    return choiceForToday(
      window.localStorage.getItem(MACHINE_KEY) ?? unsavedChoice
    );
  } catch {
    return choiceForToday(unsavedChoice);
  }
}

/**
 * The machine this browser chose today (local time), or null when none was
 * chosen or the choice was made on an earlier day; undefined while rendering
 * on the server. A convenience, so it lives in the browser and not on the
 * server.
 */
function useMachineForToday() {
  const machineId = useSyncExternalStore<string | null | undefined>(
    (listener) => {
      machineListeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        machineListeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    readMachine,
    () => undefined
  );
  const choose = (id: string) => {
    const choice = JSON.stringify({ machineId: id, day: localDay() });
    try {
      window.localStorage.setItem(MACHINE_KEY, choice);
    } catch {
      unsavedChoice = choice;
    }
    machineListeners.forEach((listener) => listener());
  };
  return [machineId, choose] as const;
}
