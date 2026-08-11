"use client";

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
import type { EquipmentRow, ProcessRow } from "~/lib/db/types";
import { EquipmentImage } from "./shared/EquipmentImage";
import { EquipmentStatusBadge } from "./shared/EquipmentStatusBadge";

interface DeleteEquipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipment: (EquipmentRow & { processes?: ProcessRow[] }) | null;
}

export function DeleteEquipmentDialog({
  open,
  onOpenChange,
  equipment,
}: DeleteEquipmentDialogProps) {
  const queryClient = useQueryClient();

  const deleteEquipment = useMutation({
    mutationFn: async (equipmentId: string) => {
      const response = await fetch(`/api/equipment/${equipmentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete equipment");
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Equipment deleted successfully");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete equipment");
    },
  });

  if (!equipment) {
    return null;
  }

  const firstImageUrl = Array.isArray(equipment.image_urls)
    ? equipment.image_urls[0]
    : null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Equipment</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this equipment? This action cannot
            be undone and will also delete all associated images.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-4 space-y-4">
          <div className="flex items-start gap-4">
            <EquipmentImage
              imageUrl={firstImageUrl}
              alt={equipment.name}
              size="thumbnail"
              className="w-24 flex-shrink-0"
            />
            <div className="flex-1 space-y-2">
              <h3 className="font-semibold">{equipment.name}</h3>
              {equipment.processes && equipment.processes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {equipment.processes.map((process) => (
                    <span
                      key={process.id}
                      className="text-muted-foreground text-sm"
                    >
                      {process.name}
                      {equipment.processes &&
                        equipment.processes.indexOf(process) <
                          equipment.processes.length - 1 &&
                        ", "}
                    </span>
                  ))}
                </div>
              )}
              {equipment.status && (
                <EquipmentStatusBadge
                  status={
                    equipment.status as
                      "available" | "in-use" | "maintenance" | "retired" | null
                  }
                />
              )}
            </div>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteEquipment.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteEquipment.mutate(equipment.id)}
            disabled={deleteEquipment.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteEquipment.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
