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
import type { KanbanCardRow } from "~/server/db/types";
import { assignKanbanCard, queryKeys, userQuery } from "~/lib/api";

type AssignCardDialogProps = {
  card: KanbanCardRow;
};

export function AssignCardDialog({ card }: AssignCardDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const assignedUser = useQuery(userQuery(card.assignee));

  const assignCard = useMutation({
    mutationFn: (assignee: string | null) =>
      assignKanbanCard(card.id, assignee),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="group hover:bg-muted focus-visible:ring-ring flex min-h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none">
          <span>{assignedUser.data?.name || "Unassigned"}</span>
          <Pencil
            className="ml-auto size-3.5 opacity-40 transition-opacity group-hover:opacity-80"
            aria-hidden="true"
          />
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
