import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import type { ProcessRow } from "~/lib/db/types";
import { queryKeys, updateProcess as updateProcessRequest } from "~/lib/api";

interface EditProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  process: ProcessRow | null;
}

export function EditProcessDialog({
  open,
  onOpenChange,
  process,
}: EditProcessDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (process) {
      setName(process.name || "");
      setDescription(process.description || "");
      setNameError(null);
    }
  }, [process]);

  const updateProcess = useMutation({
    mutationFn: async (data: {
      id: string;
      name: string;
      description: string;
    }) => updateProcessRequest(data.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processes.all() });
      // Equipment rows embed their processes, so they go stale too.
      queryClient.invalidateQueries({ queryKey: queryKeys.equipment.all() });
      toast.success("Process updated successfully");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update process");
    },
  });

  const handleClose = () => {
    setName("");
    setDescription("");
    setNameError(null);
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!process) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name is required");
      return;
    }
    setNameError(null);
    updateProcess.mutate({
      id: process.id,
      name: trimmedName,
      description,
    });
  };

  if (!process) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Process</DialogTitle>
          <DialogDescription>
            Update the process name and description.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-process-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-process-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="e.g., CNC Milling"
              aria-invalid={!!nameError}
            />
            {nameError && (
              <p className="text-destructive text-sm">{nameError}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-process-description">Description</Label>
            <Textarea
              id="edit-process-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={updateProcess.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateProcess.isPending}>
              {updateProcess.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
