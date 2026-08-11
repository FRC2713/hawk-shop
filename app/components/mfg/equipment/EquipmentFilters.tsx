"use client";

import { X, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import type { EquipmentStatus } from "./shared/EquipmentStatusBadge";
import type { ProcessRow } from "~/lib/db/types";

export interface EquipmentFilters {
  processIds: string[];
  statuses: EquipmentStatus[];
  locations: string[];
}

interface EquipmentFiltersProps {
  filters: EquipmentFilters;
  onFiltersChange: (filters: EquipmentFilters) => void;
  availableLocations: string[];
}

const STATUS_OPTIONS = [
  { value: "available" as EquipmentStatus, label: "Available" },
  { value: "in-use" as EquipmentStatus, label: "In Use" },
  { value: "maintenance" as EquipmentStatus, label: "Maintenance" },
  { value: "retired" as EquipmentStatus, label: "Retired" },
];

export function EquipmentFiltersComponent({
  filters,
  onFiltersChange,
  availableLocations,
}: EquipmentFiltersProps) {
  const [processMenuOpen, setProcessMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);

  // Fetch processes from API
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
  const hasActiveFilters =
    filters.processIds.length > 0 ||
    filters.statuses.length > 0 ||
    filters.locations.length > 0;

  const clearAllFilters = () => {
    onFiltersChange({
      processIds: [],
      statuses: [],
      locations: [],
    });
  };

  const toggleProcess = (processId: string) => {
    onFiltersChange({
      ...filters,
      processIds: filters.processIds.includes(processId)
        ? filters.processIds.filter((id) => id !== processId)
        : [...filters.processIds, processId],
    });
  };

  const toggleStatus = (status: EquipmentStatus) => {
    onFiltersChange({
      ...filters,
      statuses: filters.statuses.includes(status)
        ? filters.statuses.filter((s) => s !== status)
        : [...filters.statuses, status],
    });
  };

  const toggleLocation = (location: string) => {
    onFiltersChange({
      ...filters,
      locations: filters.locations.includes(location)
        ? filters.locations.filter((l) => l !== location)
        : [...filters.locations, location],
    });
  };

  const clearFilterType = (type: "process" | "status" | "location") => {
    if (type === "process") {
      onFiltersChange({ ...filters, processIds: [] });
    } else if (type === "status") {
      onFiltersChange({ ...filters, statuses: [] });
    } else {
      onFiltersChange({ ...filters, locations: [] });
    }
  };

  const getProcessName = (id: string) => {
    return processes.find((p) => p.id === id)?.name || id;
  };

  const getStatusLabel = (status: EquipmentStatus) => {
    return STATUS_OPTIONS.find((s) => s.value === status)?.label || status;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Process Filter */}
      <DropdownMenu open={processMenuOpen} onOpenChange={setProcessMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            {filters.processIds.length > 0
              ? `Process (${filters.processIds.length})`
              : "Process"}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {processes.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              No processes available
            </div>
          ) : (
            processes.map((process) => (
              <DropdownMenuCheckboxItem
                key={process.id}
                checked={filters.processIds.includes(process.id)}
                onCheckedChange={() => toggleProcess(process.id)}
                onSelect={(e) => e.preventDefault()}
              >
                {process.name}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status Filter */}
      <DropdownMenu open={statusMenuOpen} onOpenChange={setStatusMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            {filters.statuses.length > 0
              ? `Status (${filters.statuses.length})`
              : "Status"}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {STATUS_OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={filters.statuses.includes(option.value)}
              onCheckedChange={() => toggleStatus(option.value)}
              onSelect={(e) => e.preventDefault()}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Location Filter */}
      <DropdownMenu open={locationMenuOpen} onOpenChange={setLocationMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            {filters.locations.length > 0
              ? `Location (${filters.locations.length})`
              : "Location"}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {availableLocations.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              No locations available
            </div>
          ) : (
            availableLocations.map((location) => (
              <DropdownMenuCheckboxItem
                key={location}
                checked={filters.locations.includes(location)}
                onCheckedChange={() => toggleLocation(location)}
                onSelect={(e) => e.preventDefault()}
              >
                {location}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Selected Process Badges */}
      {filters.processIds.map((processId) => (
        <Badge key={processId} variant="secondary" className="gap-1">
          {getProcessName(processId)}
          <button
            onClick={() => toggleProcess(processId)}
            className="hover:text-destructive ml-1"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {/* Selected Status Badges */}
      {filters.statuses.map((status) => (
        <Badge key={status} variant="secondary" className="gap-1">
          {getStatusLabel(status)}
          <button
            onClick={() => toggleStatus(status)}
            className="hover:text-destructive ml-1"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {/* Selected Location Badges */}
      {filters.locations.map((location) => (
        <Badge key={location} variant="secondary" className="gap-1">
          {location}
          <button
            onClick={() => toggleLocation(location)}
            className="hover:text-destructive ml-1"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      {/* Clear All Button */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAllFilters}
          className="h-9"
        >
          <X className="mr-2 size-4" />
          Clear all
        </Button>
      )}
    </div>
  );
}
