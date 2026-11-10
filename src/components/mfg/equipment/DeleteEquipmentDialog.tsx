import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import {
  deleteEquipment as deleteEquipmentRequest,
  queryKeys,
  type EquipmentWithProcesses,
} from "~/lib/api";

interface DeleteEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: EquipmentWithProcesses | null;
  assignedCount: number;
  onDeleted?: () => void;
}

export function DeleteEquipmentDialog({
  open,
  onOpenChange,
  equipment,
  assignedCount,
  onDeleted,
}: DeleteEquipmentDialogProps) {
  const queryClient = useQueryClient();

  const deleteEquipment = useMutation({
    mutationFn: deleteEquipmentRequest,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() }),
      ]);
      toast.success(`${equipment?.name ?? "Equipment"} deleted`);
      onDeleted?.();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete equipment");
    },
  });

  if (!equipment) return null;

  const photos = equipment.image_urls?.length ?? 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {equipment.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {assignedCount > 0
              ? `${assignedCount} ${assignedCount === 1 ? "card goes" : "cards go"} back to no machine. The parts stay on the Kanban board.`
              : "No parts are assigned to it."}
            {photos > 0 &&
              ` Its ${photos === 1 ? "photo is" : `${photos} photos are`} deleted too.`}{" "}
            This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteEquipment.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              deleteEquipment.mutate(equipment.id);
            }}
            disabled={deleteEquipment.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/80"
          >
            {deleteEquipment.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Delete equipment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
