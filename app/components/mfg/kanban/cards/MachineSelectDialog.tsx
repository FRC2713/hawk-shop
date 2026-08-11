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
import { KanbanCardRow, EquipmentRow } from "~/lib/db/types";

type MachineSelectDialogProps = {
  card: KanbanCardRow;
};

async function fetchEquipment() {
  const response = await fetch("/api/equipment");
  if (!response.ok) {
    throw new Error("Failed to fetch equipment");
  }
  const data = await response.json();
  return data.equipment as EquipmentRow[];
}

export function MachineSelectDialog({ card }: MachineSelectDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: equipment = [] } = useQuery<EquipmentRow[]>({
    queryKey: ["equipment"],
    queryFn: fetchEquipment,
  });

  const sortedEquipment = useMemo(() => {
    return [...equipment].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [equipment]);

  const assignMachine = useMutation({
    mutationFn: async (machine: string | null) => {
      const response = await fetch(`/api/kanban/cards/${card.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ machine }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to assign machine");
      }

      return response.json();
    },
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["kanban-cards"] });
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
