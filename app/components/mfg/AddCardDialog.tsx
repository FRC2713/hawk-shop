"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Calendar } from "~/components/ui/calendar";
import { cn } from "~/lib/utils";
import type { ProcessRow } from "~/lib/db/types";

export interface AddCardFormData {
  processIds: string[];
  quantityPerRobot: number | "";
  quantityToMake: number | "";
  dueDate: Date | undefined;
}

interface AddCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: AddCardFormData) => void;
  isSubmitting?: boolean;
}

export function AddCardDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: AddCardDialogProps) {
  const [formData, setFormData] = useState<AddCardFormData>({
    processIds: [],
    quantityPerRobot: "",
    quantityToMake: "",
    dueDate: undefined,
  });
  const [processesOpen, setProcessesOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [errors, setErrors] = useState<{
    processes?: string;
    quantityPerRobot?: string;
    quantityToMake?: string;
  }>({});

  // Fetch processes
  const { data: processesData } = useQuery<{ processes: ProcessRow[] }>({
    queryKey: ["processes"],
    queryFn: async () => {
      const response = await fetch("/api/processes");
      if (!response.ok) throw new Error("Failed to fetch processes");
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const processes = processesData?.processes || [];

  const selectedProcesses = processes.filter((p) =>
    formData.processIds.includes(p.id)
  );

  const handleProcessToggle = (processId: string) => {
    const newIds = formData.processIds.includes(processId)
      ? formData.processIds.filter((id) => id !== processId)
      : [...formData.processIds, processId];
    setFormData({ ...formData, processIds: newIds });
    if (errors.processes) {
      setErrors({ ...errors, processes: undefined });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    const newErrors: typeof errors = {};
    if (formData.processIds.length === 0) {
      newErrors.processes = "At least one process is required";
    }
    if (formData.quantityPerRobot === "" || formData.quantityPerRobot <= 0) {
      newErrors.quantityPerRobot = "Quantity per robot must be greater than 0";
    }
    if (formData.quantityToMake === "" || formData.quantityToMake <= 0) {
      newErrors.quantityToMake = "Quantity to make must be greater than 0";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit(formData);
  };

  const handleClose = (open: boolean) => {
    if (!open && !isSubmitting) {
      // Reset form when closing
      setFormData({
        processIds: [],
        quantityPerRobot: "",
        quantityToMake: "",
        dueDate: undefined,
      });
      setErrors({});
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to Manufacturing Tracker</DialogTitle>
          <DialogDescription>
            Provide the required information to add this part to the
            manufacturing tracker.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Process Selection */}
            <div className="space-y-2">
              <Label htmlFor="processes">
                Processes <span className="text-destructive">*</span>
              </Label>
              <Popover open={processesOpen} onOpenChange={setProcessesOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={processesOpen}
                    className="w-full justify-between"
                    aria-invalid={!!errors.processes}
                  >
                    <span className="truncate">
                      {selectedProcesses.length === 0
                        ? "Select processes..."
                        : selectedProcesses.length === 1
                          ? selectedProcesses[0]?.name
                          : `${selectedProcesses.length} processes selected`}
                    </span>
                    <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <div className="max-h-60 overflow-auto p-1">
                    {processes.length === 0 ? (
                      <div className="text-muted-foreground px-2 py-1.5 text-sm">
                        No processes available
                      </div>
                    ) : (
                      processes.map((process) => {
                        const isSelected = formData.processIds.includes(
                          process.id
                        );
                        return (
                          <div
                            key={process.id}
                            className="hover:bg-accent hover:text-accent-foreground relative flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none"
                            onClick={() => handleProcessToggle(process.id)}
                          >
                            <div
                              className={cn(
                                "border-primary mr-2 flex size-4 items-center justify-center rounded-sm border",
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : "opacity-50"
                              )}
                            >
                              {isSelected && <CheckIcon className="size-4" />}
                            </div>
                            <span>{process.name}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {errors.processes && (
                <p className="text-destructive text-sm">{errors.processes}</p>
              )}
            </div>

            {/* Quantity Per Robot */}
            <div className="space-y-2">
              <Label htmlFor="quantityPerRobot">
                Quantity per Robot <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quantityPerRobot"
                type="number"
                min="1"
                value={formData.quantityPerRobot}
                onChange={(e) => {
                  const value =
                    e.target.value === "" ? "" : Number(e.target.value);
                  setFormData({ ...formData, quantityPerRobot: value });
                  if (errors.quantityPerRobot) {
                    setErrors({ ...errors, quantityPerRobot: undefined });
                  }
                }}
                placeholder="Enter quantity per robot"
                aria-invalid={!!errors.quantityPerRobot}
                disabled={isSubmitting}
              />
              {errors.quantityPerRobot && (
                <p className="text-destructive text-sm">
                  {errors.quantityPerRobot}
                </p>
              )}
            </div>

            {/* Quantity to Make */}
            <div className="space-y-2">
              <Label htmlFor="quantityToMake">
                Quantity to Make <span className="text-destructive">*</span>
              </Label>
              <Input
                id="quantityToMake"
                type="number"
                min="1"
                value={formData.quantityToMake}
                onChange={(e) => {
                  const value =
                    e.target.value === "" ? "" : Number(e.target.value);
                  setFormData({ ...formData, quantityToMake: value });
                  if (errors.quantityToMake) {
                    setErrors({ ...errors, quantityToMake: undefined });
                  }
                }}
                placeholder="Enter quantity to make"
                aria-invalid={!!errors.quantityToMake}
                disabled={isSubmitting}
              />
              {errors.quantityToMake && (
                <p className="text-destructive text-sm">
                  {errors.quantityToMake}
                </p>
              )}
            </div>

            {/* Due Date (Optional) */}
            <div className="space-y-2">
              <Label htmlFor="dueDate">Due Date (Optional)</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.dueDate && "text-muted-foreground"
                    )}
                    disabled={isSubmitting}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.dueDate ? (
                      format(formData.dueDate, "PPP")
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.dueDate}
                    onSelect={(date) => {
                      setFormData({ ...formData, dueDate: date });
                      setDatePickerOpen(false);
                    }}
                    disabled={isSubmitting}
                    initialFocus
                  />
                  {formData.dueDate && (
                    <div className="border-t p-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setFormData({ ...formData, dueDate: undefined });
                          setDatePickerOpen(false);
                        }}
                        disabled={isSubmitting}
                      >
                        Clear date
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding..." : "Add to Tracker"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
