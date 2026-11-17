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
import type { CardMachine, KanbanCardRow } from "~/server/db/types";
import { equipmentQuery, queryKeys, updateKanbanCard } from "~/lib/api";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";

type MachineSelectDialogProps = {
  card: KanbanCardRow & { linked_machine?: CardMachine | null };
};

export function MachineSelectDialog({ card }: MachineSelectDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: equipment = [] } = useQuery(equipmentQuery());

  const sortedEquipment = useMemo(() => {
    return [...equipment].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [equipment]);

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
  const machineName = cardMachineName(card);
  const unlinked = unlinkedMachineText(card);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          {sortedEquipment.map((item) => (
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
              {item.name}
            </div>
          ))}
        </div>
        {assignMachine.isPending && (
          <p className="text-muted-foreground text-sm">Updating...</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
