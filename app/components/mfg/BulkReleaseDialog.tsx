"use client";

import { useState, useEffect } from "react";
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
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";

export interface BulkReleaseFormData {
  processIds: string[];
  dueDate: Date | undefined;
  partQuantities: Array<{
    partKey: string;
    quantityPerRobot: number | "";
    quantityToMake: number | "";
  }>;
}

interface BulkReleaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedParts: Array<{
    part: BtPartMetadataInfo;
    partKey: string;
    thumbnailUrl?: string;
    onshapeParams?: {
      documentId: string;
      instanceType: string;
      instanceId: string;
      elementId: string;
    };
    partId: string;
  }>;
  onSubmit: (data: BulkReleaseFormData) => void;
  isSubmitting?: boolean;
}

export function BulkReleaseDialog({
  open,
  onOpenChange,
  selectedParts,
  onSubmit,
  isSubmitting = false,
}: BulkReleaseDialogProps) {
  const [formData, setFormData] = useState<BulkReleaseFormData>({
    processIds: [],
    dueDate: undefined,
    partQuantities: [],
  });
  const [processesOpen, setProcessesOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [errors, setErrors] = useState<{
    processes?: string;
    partQuantities?: Record<
      string,
      { quantityPerRobot?: string; quantityToMake?: string }
    >;
  }>({});

  // Initialize part quantities when dialog opens or selected parts change
  useEffect(() => {
    if (open && selectedParts.length > 0) {
      setFormData((prev) => ({
        ...prev,
        partQuantities: selectedParts.map((sp) => ({
          partKey: sp.partKey,
          quantityPerRobot:
            prev.partQuantities.find((pq) => pq.partKey === sp.partKey)
              ?.quantityPerRobot || "",
          quantityToMake:
            prev.partQuantities.find((pq) => pq.partKey === sp.partKey)
              ?.quantityToMake || "",
        })),
      }));
    }
  }, [open, selectedParts]);

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

  const handlePartQuantityChange = (
    partKey: string,
    field: "quantityPerRobot" | "quantityToMake",
    value: number | ""
  ) => {
    setFormData((prev) => ({
      ...prev,
      partQuantities: prev.partQuantities.map((pq) =>
        pq.partKey === partKey ? { ...pq, [field]: value } : pq
      ),
    }));

    // Clear error for this field
    if (errors.partQuantities?.[partKey]?.[field]) {
      setErrors((prev) => ({
        ...prev,
        partQuantities: {
          ...prev.partQuantities,
          [partKey]: {
            ...prev.partQuantities?.[partKey],
            [field]: undefined,
          },
        },
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    const newErrors: typeof errors = {};

    if (formData.processIds.length === 0) {
      newErrors.processes = "At least one process is required";
    }

    const partQuantityErrors: Record<
      string,
      { quantityPerRobot?: string; quantityToMake?: string }
    > = {};

    formData.partQuantities.forEach((pq) => {
      const partErrors: { quantityPerRobot?: string; quantityToMake?: string } =
        {};

      if (pq.quantityPerRobot === "" || pq.quantityPerRobot <= 0) {
        partErrors.quantityPerRobot =
          "Quantity per robot must be greater than 0";
      }
      if (pq.quantityToMake === "" || pq.quantityToMake <= 0) {
        partErrors.quantityToMake = "Quantity to make must be greater than 0";
      }

      if (Object.keys(partErrors).length > 0) {
        partQuantityErrors[pq.partKey] = partErrors;
      }
    });

    if (Object.keys(partQuantityErrors).length > 0) {
      newErrors.partQuantities = partQuantityErrors;
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
        dueDate: undefined,
        partQuantities: [],
      });
      setErrors({});
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>
            Release {selectedParts.length} Parts to Manufacturing
          </DialogTitle>
          <DialogDescription>
            Set common processes and due date, then specify quantities for each
            part.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="max-h-[60vh] flex-1 overflow-y-auto pr-4">
            <div className="space-y-4 py-4">
              {/* Common Fields */}
              <div className="space-y-4 border-b pb-4">
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
                                  {isSelected && (
                                    <CheckIcon className="size-4" />
                                  )}
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
                    <p className="text-destructive text-sm">
                      {errors.processes}
                    </p>
                  )}
                </div>

                {/* Due Date (Optional) */}
                <div className="space-y-2">
                  <Label htmlFor="dueDate">Due Date (Optional)</Label>
                  <Popover
                    open={datePickerOpen}
                    onOpenChange={setDatePickerOpen}
                  >
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

              {/* Part Quantities */}
              <div className="space-y-4">
                <Label>Part Quantities</Label>
                <div className="space-y-4">
                  {selectedParts.map((selectedPart) => {
                    const partQuantity = formData.partQuantities.find(
                      (pq) => pq.partKey === selectedPart.partKey
                    );
                    const partErrors =
                      errors.partQuantities?.[selectedPart.partKey];

                    return (
                      <div
                        key={selectedPart.partKey}
                        className="space-y-3 rounded-lg border p-4"
                      >
                        <div className="flex items-center gap-3">
                          {selectedPart.thumbnailUrl && (
                            <img
                              src={`/api/onshape/thumbnail?url=${encodeURIComponent(selectedPart.thumbnailUrl)}`}
                              alt={selectedPart.part.name || "Part"}
                              className="h-12 w-12 rounded object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              {selectedPart.part.name ||
                                `Part ${selectedPart.partId}`}
                            </p>
                            {selectedPart.part.partNumber && (
                              <p className="text-muted-foreground truncate font-mono text-sm">
                                {selectedPart.part.partNumber}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label
                              htmlFor={`qty-robot-${selectedPart.partKey}`}
                            >
                              Quantity per Robot{" "}
                              <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id={`qty-robot-${selectedPart.partKey}`}
                              type="number"
                              min="1"
                              value={partQuantity?.quantityPerRobot || ""}
                              onChange={(e) => {
                                const value =
                                  e.target.value === ""
                                    ? ""
                                    : Number(e.target.value);
                                handlePartQuantityChange(
                                  selectedPart.partKey,
                                  "quantityPerRobot",
                                  value
                                );
                              }}
                              placeholder="Enter quantity"
                              aria-invalid={!!partErrors?.quantityPerRobot}
                              disabled={isSubmitting}
                            />
                            {partErrors?.quantityPerRobot && (
                              <p className="text-destructive text-xs">
                                {partErrors.quantityPerRobot}
                              </p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={`qty-make-${selectedPart.partKey}`}>
                              Quantity to Make{" "}
                              <span className="text-destructive">*</span>
                            </Label>
                            <Input
                              id={`qty-make-${selectedPart.partKey}`}
                              type="number"
                              min="1"
                              value={partQuantity?.quantityToMake || ""}
                              onChange={(e) => {
                                const value =
                                  e.target.value === ""
                                    ? ""
                                    : Number(e.target.value);
                                handlePartQuantityChange(
                                  selectedPart.partKey,
                                  "quantityToMake",
                                  value
                                );
                              }}
                              placeholder="Enter quantity"
                              aria-invalid={!!partErrors?.quantityToMake}
                              disabled={isSubmitting}
                            />
                            {partErrors?.quantityToMake && (
                              <p className="text-destructive text-xs">
                                {partErrors.quantityToMake}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? `Releasing ${selectedParts.length} parts...`
                : `Release ${selectedParts.length} Parts`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
