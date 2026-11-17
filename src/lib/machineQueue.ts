/**
 * The rules for which parts a machine can take and which wait in its queue,
 * shared by the server (queues, workflow actions, card edits) and the board's
 * machine pickers. No server imports, so client components can use it.
 */
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

/** Client card and equipment types leave `processes` optional; none is []. */
type Processes = { processes?: ReadonlyArray<{ id: string }> };
export type QueueMachine = Processes & { id: string; status: string | null };
export type QueueCard = Processes & {
  id: string;
  column_id: string;
  machine_id: string | null;
  queue_position: number | null;
  date_created: string;
  due_date: string | null;
};

export type MachineRefusal =
  "machine_needs_maintenance" | "machine_lacks_process";

const sharesProcess = (machine: Processes, card: Processes) =>
  (card.processes ?? []).some((process) =>
    (machine.processes ?? []).some((own) => own.id === process.id)
  );

/**
 * Why `machine` can't take `card`, or null when it can. A machine flagged for
 * maintenance takes nothing; otherwise it takes a part that shares one of its
 * processes, or a part with no processes at all.
 */
export function machineRefusal(
  machine: Pick<QueueMachine, "status" | "processes">,
  card: Processes
): MachineRefusal | null {
  if (machine.status === "maintenance") return "machine_needs_maintenance";
  if (card.processes?.length && !sharesProcess(machine, card))
    return "machine_lacks_process";
  return null;
}

/**
 * Where a card sits in a machine's queue: "assigned" when it is a Backlog part
 * on this machine, "waiting" when it is a Backlog part with no machine that
 * shares one of the machine's processes. A waiting part with no processes is
 * in no machine's queue.
 */
function queueGroup(
  machine: Pick<QueueMachine, "id" | "processes">,
  card: QueueCard
): "assigned" | "waiting" | null {
  if (card.column_id !== WORKFLOW_COLUMN_IDS.backlog) return null;
  if (card.machine_id === machine.id) return "assigned";
  if (!card.machine_id && sharesProcess(machine, card)) return "waiting";
  return null;
}

/** Oldest release first, then due date (none last). */
function byDefaultOrder(a: QueueCard, b: QueueCard) {
  return (
    a.date_created.localeCompare(b.date_created) ||
    (a.due_date ?? "￿").localeCompare(b.due_date ?? "￿") ||
    a.id.localeCompare(b.id)
  );
}

/** Positioned cards first, lowest position first; the rest in default order. */
export function byQueueOrder(a: QueueCard, b: QueueCard) {
  return (
    (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity) ||
    byDefaultOrder(a, b)
  );
}

/**
 * A machine's queue: every positioned card first, by position; then its own
 * unpositioned parts; then unpositioned waiting parts, each in default order.
 */
export function machineQueue<C extends QueueCard>(
  machine: Pick<QueueMachine, "id" | "processes">,
  cards: C[]
): C[] {
  const rank = (card: C) => (queueGroup(machine, card) === "assigned" ? 0 : 1);
  return cards
    .filter((card) => queueGroup(machine, card) !== null)
    .sort(
      (a, b) =>
        (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity) ||
        rank(a) - rank(b) ||
        byDefaultOrder(a, b)
    );
}
