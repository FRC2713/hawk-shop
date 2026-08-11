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
import type { ProcessRow } from "~/lib/db/types";

interface DeleteProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  process: ProcessRow | null;
}

export function DeleteProcessDialog({
  open,
  onOpenChange,
  process,
}: DeleteProcessDialogProps) {
  const queryClient = useQueryClient();

  const deleteProcess = useMutation({
    mutationFn: async (processId: string) => {
      const response = await fetch(`/api/processes/${processId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete process");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Process deleted successfully");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete process");
    },
  });

  if (!process) {
    return null;
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Process</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete &quot;{process.name}&quot;? This
            action cannot be undone. The process will be removed from any
            equipment and kanban cards that use it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-4">
          <div className="bg-muted/50 rounded-md border p-3">
            <h3 className="font-semibold">{process.name}</h3>
            {process.description && (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {process.description}
              </p>
            )}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteProcess.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteProcess.mutate(process.id)}
            disabled={deleteProcess.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteProcess.isPending && (
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
