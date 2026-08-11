"use client";

import { useState } from "react";
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

interface AddProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddProcessDialog({
  open,
  onOpenChange,
}: AddProcessDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const createProcess = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const response = await fetch("/api/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name.trim(),
          description: data.description.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create process");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Process added successfully");
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to add process");
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
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name is required");
      return;
    }
    setNameError(null);
    createProcess.mutate({ name: trimmedName, description });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Process</DialogTitle>
          <DialogDescription>
            Add a new manufacturing process. Processes can be assigned to
            equipment and kanban cards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="process-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="process-name"
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
            <Label htmlFor="process-description">Description</Label>
            <Textarea
              id="process-description"
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
              disabled={createProcess.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createProcess.isPending}>
              {createProcess.isPending && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Add Process
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
