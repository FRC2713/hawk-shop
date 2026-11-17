import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { kanbanCardsQuery } from "~/lib/api";
import { machineQueue, type QueueMachine } from "~/lib/machineQueue";

/** How many parts wait in each machine's queue, by machine id. */
export function useMachineQueueCounts(machines: QueueMachine[]) {
  const { data: cards = [] } = useQuery(kanbanCardsQuery());
  return useMemo(
    () =>
      new Map(
        machines.map((machine) => [
          machine.id,
          machineQueue(machine, cards).length,
        ])
      ),
    [machines, cards]
  );
}
