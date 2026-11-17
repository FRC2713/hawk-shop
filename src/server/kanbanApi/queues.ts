import "virtual:hawk-shop/server-only";

import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { equipment, equipmentProcesses } from "~/server/db/schema";
import type { EquipmentRow, KanbanCardWithProcesses } from "~/server/db/types";
import { getCards } from "~/server/kanbanApi/cards";

/** The column whose cards wait in queues. */
export const BACKLOG_COLUMN_ID = "backlog";

/**
 * Queues are derived from Backlog cards, never stored. Cards a mentor
 * positioned come first, lowest position first; the rest follow oldest
 * release first, then due date (none last).
 */
function byQueueOrder(a: KanbanCardWithProcesses, b: KanbanCardWithProcesses) {
  return (
    (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity) ||
    a.date_created.localeCompare(b.date_created) ||
    (a.due_date ?? "￿").localeCompare(b.due_date ?? "￿") ||
    a.id.localeCompare(b.id)
  );
}

async function backlog() {
  const result = await getCards();
  if (result.error) throw new Error(result.error);
  return result.cards.filter((card) => card.column_id === BACKLOG_COLUMN_ID);
}

const hasAnyProcess = (card: KanbanCardWithProcesses, processIds: string[]) =>
  card.processes.some((process) => processIds.includes(process.id));

/** Backlog cards with this process and no machine. */
export async function getProcessQueue(processId: string) {
  return (await backlog())
    .filter((card) => !card.machine_id && hasAnyProcess(card, [processId]))
    .sort(byQueueOrder);
}

/** Thrown when a queue is asked of equipment that doesn't exist. */
export class MachineNotFoundError extends Error {
  constructor() {
    super("Machine not found");
  }
}

/**
 * A machine's queue: Backlog cards assigned to it, then Backlog cards with no
 * machine whose processes overlap the machine's.
 */
export async function getMachineQueue(machineId: string): Promise<{
  machine: EquipmentRow;
  cards: KanbanCardWithProcesses[];
}> {
  const machine = db
    .select()
    .from(equipment)
    .where(eq(equipment.id, machineId))
    .get();
  if (!machine) throw new MachineNotFoundError();
  const processIds = db
    .select({ id: equipmentProcesses.process_id })
    .from(equipmentProcesses)
    .where(eq(equipmentProcesses.equipment_id, machineId))
    .all()
    .map((row) => row.id);
  const cards = await backlog();
  const assigned = cards
    .filter((card) => card.machine_id === machineId)
    .sort(byQueueOrder);
  const waiting = cards
    .filter((card) => !card.machine_id && hasAnyProcess(card, processIds))
    .sort(byQueueOrder);
  return { machine, cards: [...assigned, ...waiting] };
}
