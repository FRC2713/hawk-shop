import { useState } from "react";
import {
  Edit,
  Save,
  Settings2,
  X,
  Image,
  ChevronDown,
  User,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { KanbanConfig } from "~/lib/kanbanApi/columnTypes";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import type { ProcessRow } from "~/lib/db/types";

interface KanbanBoardControlsProps {
  isEditMode: boolean;
  handleEnterEditMode: () => void;
  config: KanbanConfig | undefined;
  onEditCancel: () => void;
  onEditSave: () => void;
  onHideImages: () => void;
  hideImages: boolean;
  isSaving: boolean;
  selectedProcessIds: string[];
  onProcessFilterChange: (processIds: string[]) => void;
  sortByUser: boolean;
  onSortByUserChange: (value: boolean) => void;
}

export function KanbanBoardControls({
  isEditMode,
  handleEnterEditMode,
  config,
  onEditCancel,
  onEditSave,
  isSaving,
  onHideImages,
  hideImages,
  selectedProcessIds,
  onProcessFilterChange,
  sortByUser,
  onSortByUserChange,
}: KanbanBoardControlsProps) {
  const [processMenuOpen, setProcessMenuOpen] = useState(false);

  const toggleValues = (() => {
    const values: string[] = [];
    if (!hideImages) values.push("images");
    if (sortByUser) values.push("sortByUser");
    return values;
  })();

  const handleValueChange = (values: string[]) => {
    const hasImages = values.includes("images");
    const hasSortByUser = values.includes("sortByUser");

    if (hasImages !== !hideImages) {
      onHideImages();
    }
    if (hasSortByUser !== sortByUser) {
      onSortByUserChange(hasSortByUser);
    }
  };

  const { data: processesData } = useQuery<{ processes: ProcessRow[] }>({
    queryKey: ["processes"],
    queryFn: async () => {
      const response = await fetch("/api/processes");
      if (!response.ok) throw new Error("Failed to fetch processes");
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const processes = processesData?.processes || [];

  const toggleProcess = (processId: string) => {
    const newIds = selectedProcessIds.includes(processId)
      ? selectedProcessIds.filter((id) => id !== processId)
      : [...selectedProcessIds, processId];
    onProcessFilterChange(newIds);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <DropdownMenu open={processMenuOpen} onOpenChange={setProcessMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            {selectedProcessIds.length > 0
              ? `Processes (${selectedProcessIds.length})`
              : "Filter by Process"}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {selectedProcessIds.length > 0 && (
            <>
              <DropdownMenuItem onClick={() => onProcessFilterChange([])}>
                Show all
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {processes.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              No processes available
            </div>
          ) : (
            processes.map((process) => (
              <DropdownMenuCheckboxItem
                key={process.id}
                checked={selectedProcessIds.includes(process.id)}
                onCheckedChange={() => toggleProcess(process.id)}
                onSelect={(e) => e.preventDefault()}
              >
                {process.name}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        value={toggleValues}
        onValueChange={handleValueChange}
      >
        <ToggleGroupItem value="images" aria-label="Toggle images">
          <Image className="size-4" />
          <span className="hidden sm:inline">
            {hideImages ? "Show Images" : "Hide Images"}
          </span>
        </ToggleGroupItem>
        <ToggleGroupItem value="sortByUser" aria-label="Sort by user">
          <User className="size-4" />
          <span className="hidden sm:inline">Sort by User</span>
        </ToggleGroupItem>
      </ToggleGroup>

      {/* Edit Mode Controls */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        {!isEditMode ? (
          <Button
            onClick={handleEnterEditMode}
            variant="outline"
            size="sm"
            disabled={!config}
            className="w-full sm:w-auto"
          >
            <Edit className="mr-2 size-4" />
            <span className="sm:inline">Edit Columns</span>
          </Button>
        ) : (
          <>
            <Button
              onClick={onEditCancel}
              variant="outline"
              size="sm"
              disabled={isSaving}
              className="flex-1 sm:flex-initial"
            >
              <X className="mr-2 size-4" />
              Cancel
            </Button>
            <Button
              onClick={onEditSave}
              size="sm"
              disabled={isSaving}
              className="flex-1 sm:flex-initial"
            >
              <Save className="mr-2 size-4" />
              Save
            </Button>
          </>
        )}
        {/* Status indicator */}
        {isSaving && (
          <div className="bg-muted/80 text-muted-foreground flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
            <Settings2 className="size-3 animate-spin" />
            <span className="hidden sm:inline">Saving...</span>
          </div>
        )}
      </div>
    </div>
  );
}
