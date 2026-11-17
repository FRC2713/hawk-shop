import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import {
  claimCard,
  equipmentQuery,
  kanbanCardsQuery,
  machineQueueQuery,
  markCardDone,
  needsMaintenance,
  queryKeys,
  usersQuery,
  ApiError,
  type EquipmentWithProcesses,
  type KanbanCardWithProcesses,
} from "~/lib/api";
import { cardOnshapeUrl } from "~/lib/onshapeLinks";
import { partHref } from "~/lib/phone";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import { PartList, PartRow } from "./PartRow";

/**
 * The Next up tab: the operator's machine for the day, the part they're
 * making there with Done, and the machine's queue with Claim on each row.
 * The machine is remembered per browser (`useMachineForToday`).
 */
export function NextUp({ viewerId }: { viewerId: string }) {
  const [machineId, setMachineId] = useMachineForToday();
  const [changing, setChanging] = useState(false);
  const equipment = useQuery(equipmentQuery());
  const machine = equipment.data?.find((item) => item.id === machineId);

  // `undefined` until the browser's choice is read, so the server render and
  // hydration don't flash the picker at an operator who already chose.
  if (machineId === undefined || equipment.isPending)
    return (
      <TabShell>
        <p role="status" className="text-muted-foreground">
          Loading...
        </p>
      </TabShell>
    );
  if (equipment.isError)
    return (
      <TabShell>
        <ErrorMessage error={equipment.error} />
      </TabShell>
    );

  const choose = (id: string) => {
    setMachineId(id);
    setChanging(false);
  };

  if (!machine)
    return (
      <TabShell>
        <p className="font-semibold">Which machine are you on?</p>
        <MachinePicker machines={equipment.data} onChoose={choose} />
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
          <MachinePicker
            machines={equipment.data}
            current={machine.id}
            onChoose={choose}
          />
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

function MachinePicker({
  machines,
  current,
  onChoose,
}: {
  machines: EquipmentWithProcesses[];
  current?: string;
  onChoose: (id: string) => void;
}) {
  if (!machines.length)
    return (
      <p className="text-muted-foreground">
        No machines yet. Add one on the Equipment page.
      </p>
    );
  return (
    <ul
      aria-label="Machines"
      className="bg-card overflow-hidden rounded-xl border"
    >
      {machines.map((machine) => (
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
                  {machine.processes.map((process) => process.name).join(", ")}
                </span>
              )}
            </span>
            {needsMaintenance(machine) && (
              <span className="text-destructive shrink-0 text-xs font-semibold">
                Needs maintenance
              </span>
            )}
          </button>
        </li>
      ))}
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
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });

  const claim = useMutation({
    mutationFn: (card: KanbanCardWithProcesses) =>
      claimCard(card.id, { machineId: machine.id }),
    onSuccess: (card) => toast.success(`Claimed ${card.title}`),
    onError: (error, card) =>
      toast.error(
        error instanceof ApiError && error.status === 409
          ? error.message
          : "Failed to claim part",
        { description: <ErrorMessage error={error} cardId={card.id} /> }
      ),
    onSettled: refresh,
  });
  const done = useMutation({
    mutationFn: (card: KanbanCardWithProcesses) => markCardDone(card.id),
    onSuccess: (card) => toast.success(`${card.title} sent to review`),
    onError: (error, card) =>
      toast.error("Failed to send part to review", {
        description: <ErrorMessage error={error} cardId={card.id} />,
      }),
    onSettled: refresh,
  });

  const nameOf = (subject: string | null) =>
    users.find((user) => user.onshape_user_id === subject)?.name ?? null;
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
  const waiting = queue.data?.cards ?? [];
  const summary = [
    machine.processes?.map((process) => process.name).join(", "),
    queue.data &&
      (waiting.length === 1 ? "1 waiting" : `${waiting.length} waiting`),
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
          submitter={nameOf(card.created_by)}
          sop={
            machine.id === card.machine_id
              ? machine.documentation_url
              : undefined
          }
          machineName={card.linked_machine?.name ?? null}
          finishing={done.isPending && done.variables?.id === card.id}
          onDone={() => done.mutate(card)}
        />
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-base">Waiting for {machine.name}</h2>
        {queue.isPending ? (
          <p role="status" className="text-muted-foreground">
            Loading queue...
          </p>
        ) : queue.isError ? (
          <ErrorMessage error={queue.error} />
        ) : waiting.length === 0 ? (
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
        )}
      </section>
    </>
  );
}

function WorkingOn({
  card,
  submitter,
  sop,
  machineName,
  finishing,
  onDone,
}: {
  card: KanbanCardWithProcesses;
  submitter: string | null;
  sop: string | null | undefined;
  machineName: string | null;
  finishing: boolean;
  onDone: () => void;
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
      <Button
        className="h-12 w-full text-base font-semibold"
        disabled={finishing}
        onClick={onDone}
      >
        Done, send to review
      </Button>
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
 * Material, quantity and due date, and "any <process>" for a part waiting in
 * the process queue rather than assigned to this machine.
 */
function QueueDetail({
  card,
  machine,
}: {
  card: KanbanCardWithProcesses;
  machine: EquipmentWithProcesses;
}) {
  const facts = [
    card.onshape_material,
    card.quantity_to_make != null && `×${card.quantity_to_make}`,
    card.due_date && `due ${format(parseISO(card.due_date), "EEE")}`,
  ].filter(Boolean);
  const process =
    card.machine_id === null
      ? (card.processes ?? []).find((process) =>
          machine.processes?.some((own) => own.id === process.id)
        )
      : undefined;
  return (
    <span className="flex flex-col">
      {facts.length > 0 && <span>{facts.join(" · ")}</span>}
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

function readMachine(): string | null {
  try {
    return window.localStorage.getItem(MACHINE_KEY) ?? unsavedChoice;
  } catch {
    return unsavedChoice;
  }
}

/**
 * The machine this browser chose for today, or null when none; undefined
 * while rendering on the server. A convenience, so it lives in the browser
 * and not on the server.
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
    try {
      window.localStorage.setItem(MACHINE_KEY, id);
    } catch {
      unsavedChoice = id;
    }
    machineListeners.forEach((listener) => listener());
  };
  return [machineId, choose] as const;
}
