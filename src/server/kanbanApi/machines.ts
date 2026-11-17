import "virtual:hawk-shop/server-only";

import { eq, inArray } from "drizzle-orm";
import { groupBy } from "~/lib/groupBy";
import { machineRefusal } from "~/lib/machineQueue";
import { db, type Transaction } from "~/server/db/client";
import {
  equipment,
  equipmentProcesses,
  kanbanCardProcesses,
} from "~/server/db/schema";
import type { EquipmentRow } from "~/server/db/types";
import {
  MachineLacksProcessError,
  MachineNeedsMaintenanceError,
  MachineNotFoundError,
} from "~/server/kanbanApi/workflowErrors";

type Reader = Transaction | typeof db;

export type MachineWithProcessIds = EquipmentRow & {
  processes: { id: string }[];
};

/** The equipment record with its process ids, or undefined. */
export function findMachine(
  reader: Reader,
  id: string
): MachineWithProcessIds | undefined {
  const machine = reader
    .select()
    .from(equipment)
    .where(eq(equipment.id, id))
    .get();
  if (!machine) return undefined;
  const processes = reader
    .select({ id: equipmentProcesses.process_id })
    .from(equipmentProcesses)
    .where(eq(equipmentProcesses.equipment_id, id))
    .all();
  return { ...machine, processes };
}

/** Like `findMachine`, but a missing machine is a `MachineNotFoundError`. */
export function requireMachine(
  reader: Reader,
  id: string
): MachineWithProcessIds {
  const machine = findMachine(reader, id);
  if (!machine) throw new MachineNotFoundError();
  return machine;
}

/**
 * Throws unless the machine can take every one of `cardIds` (see
 * `machineRefusal`): `MachineNotFoundError`, `MachineNeedsMaintenanceError`,
 * or `MachineLacksProcessError` naming the cards it can't make.
 */
export function requireMachineCanTake(
  reader: Reader,
  machineId: string,
  cardIds: string[]
) {
  const machine = requireMachine(reader, machineId);
  const processesByCard = groupBy(
    reader
      .select({
        card_id: kanbanCardProcesses.card_id,
        id: kanbanCardProcesses.process_id,
      })
      .from(kanbanCardProcesses)
      .where(inArray(kanbanCardProcesses.card_id, cardIds))
      .all(),
    (row) => row.card_id
  );
  const refusals = cardIds.map((id) => ({
    id,
    refusal: machineRefusal(machine, {
      processes: processesByCard.get(id) ?? [],
    }),
  }));
  if (refusals.some((card) => card.refusal === "machine_needs_maintenance"))
    throw new MachineNeedsMaintenanceError(machine.name, cardIds);
  const lacking = refusals
    .filter((card) => card.refusal === "machine_lacks_process")
    .map((card) => card.id);
  if (lacking.length) throw new MachineLacksProcessError(machine.name, lacking);
}
