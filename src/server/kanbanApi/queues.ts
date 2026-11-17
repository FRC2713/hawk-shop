import "virtual:hawk-shop/server-only";

import { byQueueOrder, machineQueue } from "~/lib/machineQueue";
import { db } from "~/server/db/client";
import type { EquipmentRow, KanbanCardWithProcesses } from "~/server/db/types";
import { getCards } from "~/server/kanbanApi/cards";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { requireMachine } from "~/server/kanbanApi/machines";

/** Queues are derived from Backlog cards, never stored. */
async function backlog() {
  const result = await getCards();
  if (result.error) throw new Error(result.error);
  return result.cards.filter(
    (card) => card.column_id === WORKFLOW_COLUMN_IDS.backlog
  );
}

/** Backlog cards with this process and no machine. */
export async function getProcessQueue(processId: string) {
  return (await backlog())
    .filter(
      (card) =>
        !card.machine_id &&
        card.processes.some((process) => process.id === processId)
    )
    .sort(byQueueOrder);
}

/**
 * A machine's queue (see `machineQueue`). A machine that doesn't exist is a
 * `MachineNotFoundError`.
 */
export async function getMachineQueue(machineId: string): Promise<{
  machine: EquipmentRow;
  cards: KanbanCardWithProcesses[];
}> {
  const { processes, ...machine } = requireMachine(db, machineId);
  return {
    machine,
    cards: machineQueue({ id: machine.id, processes }, await backlog()),
  };
}
