import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Wrench } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import type { CardMachine, KanbanCardRow, ProcessRow } from "~/server/db/types";
import { equipmentQuery, queryKeys, updateKanbanCard } from "~/lib/api";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";
import { machineRefusal } from "~/lib/machineQueue";
import { useMachineQueueCounts } from "~/components/mfg/kanban/useMachineQueueCounts";

type MachineSelectDialogProps = {
  card: KanbanCardRow & {
    processes?: ProcessRow[];
    linked_machine?: CardMachine | null;
  };
};

export function MachineSelectDialog({ card }: MachineSelectDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: equipment = [] } = useQuery(equipmentQuery());

  // Only machines that can take the part: not in maintenance and sharing one
  // of its processes. The current machine stays listed so it shows as chosen.
  const choices = useMemo(() => {
    const processes = card.processes ?? [];
    return equipment
      .filter(
        (item) =>
          item.id === card.machine_id || !machineRefusal(item, { processes })
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
  }, [equipment, card.processes, card.machine_id]);
  const queueCounts = useMachineQueueCounts(choices);

  const assignMachine = useMutation({
    mutationFn: (machineId: string | null) =>
      updateKanbanCard(card.id, { machine_id: machineId }),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    },
  });

  const handleSelect = (machineId: string | null) => {
    if (assignMachine.isPending) return;
    assignMachine.mutate(machineId);
  };
  const handleOpenChange = (next: boolean) => {
    if (next) assignMachine.reset();
    setOpen(next);
  };
  const machineName = cardMachineName(card);
  const unlinked = unlinkedMachineText(card);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button className="group hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium transition-colors">
          {machineName ? (
            <span>{machineName}</span>
          ) : unlinked ? (
            <span title="This text matches no equipment. Pick a machine to link it.">
              {unlinked}{" "}
              <span className="text-muted-foreground font-normal">
                (unlinked)
              </span>
            </span>
          ) : (
            <span>Unassigned</span>
          )}
          <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select Machine</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[min(60vh,400px)] flex-col gap-2 overflow-y-auto">
          <div
            className="hover:bg-primary/10 flex cursor-pointer items-center gap-3 rounded-md border p-2"
            onClick={() => handleSelect(null)}
            onKeyDown={(e) => e.key === "Enter" && handleSelect(null)}
            role="button"
            tabIndex={0}
          >
            <Wrench className="text-muted-foreground size-4" />
            <span>None (Unassigned)</span>
          </div>
          {choices.map((item) => (
            <div
              className="hover:bg-primary/10 flex cursor-pointer items-center gap-3 rounded-md border p-2"
              key={item.id}
              aria-current={item.id === card.machine_id || undefined}
              onClick={() => handleSelect(item.id)}
              onKeyDown={(e) => e.key === "Enter" && handleSelect(item.id)}
              role="button"
              tabIndex={0}
            >
              <Wrench className="text-primary size-4" />
              <span className="flex-1">{item.name}</span>
              <span className="text-muted-foreground text-xs">
                {queueCounts.get(item.id) ?? 0} queued
              </span>
            </div>
          ))}
          {choices.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No machine can take this part right now.
            </p>
          )}
        </div>
        {assignMachine.isPending && (
          <p className="text-muted-foreground text-sm">Updating...</p>
        )}
        {assignMachine.error && (
          <ErrorMessage error={assignMachine.error} cardId={card.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}
