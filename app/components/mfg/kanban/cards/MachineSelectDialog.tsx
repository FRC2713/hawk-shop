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
import { KanbanCardRow } from "~/lib/db/types";
import { equipmentQuery, queryKeys, updateKanbanCard } from "~/lib/api";

type MachineSelectDialogProps = {
  card: KanbanCardRow;
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
    mutationFn: (machine: string | null) =>
      updateKanbanCard(card.id, { machine }),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    },
  });

  const handleSelect = (machine: string | null) => {
    if (assignMachine.isPending) return;
    assignMachine.mutate(machine);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="group hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium transition-colors">
          <span>{card.machine || "Unassigned"}</span>
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
              onClick={() => handleSelect(item.name)}
              onKeyDown={(e) => e.key === "Enter" && handleSelect(item.name)}
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
