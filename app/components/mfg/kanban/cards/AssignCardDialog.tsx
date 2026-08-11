import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { UsersList } from "~/components/users/UsersList";
import { KanbanCardRow, UserRow } from "~/lib/db/types";

type AssignCardDialogProps = {
  card: KanbanCardRow;
};

export function AssignCardDialog({ card }: AssignCardDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const assignedUser = useQuery<UserRow>({
    queryKey: ["users", card.assignee],
    queryFn: async () => {
      const response = await fetch(`/api/users/${card.assignee}`);
      return response.json();
    },
    enabled: !!card.assignee,
  });

  const assignCard = useMutation({
    mutationFn: async (assignee: string | null) => {
      const response = await fetch(`/api/kanban/cards/${card.id}/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assignee }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to assign card");
      }

      return response.json();
    },
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["kanban-cards"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="group hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm font-medium transition-colors">
          <span>{assignedUser.data?.name || "Unassigned"}</span>
          <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Card To</DialogTitle>
        </DialogHeader>
        <UsersList
          onSelect={(user) =>
            assignCard.mutateAsync(user?.onshape_user_id ?? null)
          }
        />
      </DialogContent>
    </Dialog>
  );
}
