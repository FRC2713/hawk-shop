import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { EquipmentStatus } from "./EquipmentStatusBadge";
import { processesQuery } from "~/lib/api";

export interface EquipmentFormData {
  name: string;
  description: string;
  processIds: string[];
  location: string;
  status: EquipmentStatus | "";
  documentationUrl: string;
}

export interface EquipmentFormErrors {
  name?: string;
  description?: string;
  processes?: string;
  location?: string;
  status?: string;
  documentationUrl?: string;
}

interface EquipmentFormFieldsProps {
  formData: EquipmentFormData;
  onChange: (field: keyof EquipmentFormData, value: string | string[]) => void;
  errors?: EquipmentFormErrors;
}

const statusOptions: { value: EquipmentStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "in-use", label: "In Use" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
];

export function EquipmentFormFields({
  formData,
  onChange,
  errors = {},
}: EquipmentFormFieldsProps) {
  const { data: processes = [] } = useQuery(processesQuery());
  const [processesOpen, setProcessesOpen] = useState(false);

  const handleProcessToggle = (processId: string) => {
    const currentIds = formData.processIds || [];
    const newIds = currentIds.includes(processId)
      ? currentIds.filter((id) => id !== processId)
      : [...currentIds, processId];
    onChange("processIds", newIds);
  };

  const selectedProcesses = processes.filter((p) =>
    formData.processIds?.includes(p.id)
  );
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="e.g., Drill Press"
          aria-invalid={!!errors.name}
        />
        {errors.name && (
          <p className="text-destructive text-sm">{errors.name}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => onChange("description", e.target.value)}
          placeholder="Equipment description and notes..."
          rows={3}
          aria-invalid={!!errors.description}
        />
        {errors.description && (
          <p className="text-destructive text-sm">{errors.description}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Processes</Label>
        <Popover open={processesOpen} onOpenChange={setProcessesOpen}>
          <PopoverTrigger asChild>
            <Button
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
                  const isSelected = formData.processIds?.includes(process.id);
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            value={formData.status || undefined}
            onValueChange={(value) =>
              onChange("status", value as EquipmentStatus)
            }
          >
            <SelectTrigger id="status" aria-invalid={!!errors.status}>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.status && (
            <p className="text-destructive text-sm">{errors.status}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={formData.location}
          onChange={(e) => onChange("location", e.target.value)}
          placeholder="e.g., Shop A, Toolbox 1"
          aria-invalid={!!errors.location}
        />
        {errors.location && (
          <p className="text-destructive text-sm">{errors.location}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="documentationUrl">Documentation URL</Label>
        <Input
          id="documentationUrl"
          type="url"
          value={formData.documentationUrl}
          onChange={(e) => onChange("documentationUrl", e.target.value)}
          placeholder="https://example.com/manual.pdf"
          aria-invalid={!!errors.documentationUrl}
        />
        {errors.documentationUrl && (
          <p className="text-destructive text-sm">{errors.documentationUrl}</p>
        )}
      </div>
    </div>
  );
}
