import { useState } from "react";
import {
  AlertTriangle,
  Edit,
  Save,
  Settings2,
  X,
  Image,
  ChevronDown,
  User,
  FolderKanban,
  Rows3,
} from "lucide-react";
import { ProjectFilter } from "~/components/mfg/ProjectFilter";
import { useQuery } from "@tanstack/react-query";
import type { KanbanConfig } from "~/server/kanbanApi/columnTypes";
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
import { processesQuery } from "~/lib/api";
import { ProcessIcon } from "~/components/mfg/processes/ProcessIcon";

interface KanbanBoardControlsProps {
  isEditMode: boolean;
  handleEnterEditMode: () => void;
  config: KanbanConfig | undefined;
  onEditCancel: () => void;
  onEditSave: () => void;
  onHideImages: () => void;
  hideImages: boolean;
  isSaving: boolean;
  hasWarningsOnly: boolean;
  onHasWarningsOnlyChange: (value: boolean) => void;
  selectedProcessIds: string[];
  onProcessFilterChange: (processIds: string[]) => void;
  sortByUser: boolean;
  onSortByUserChange: (value: boolean) => void;
  selectedProjectIds: string[];
  onProjectFilterChange: (projectIds: string[]) => void;
  sortByProject: boolean;
  onSortByProjectChange: (value: boolean) => void;
  groupByProject: boolean;
  onGroupByProjectChange: (value: boolean) => void;
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
  hasWarningsOnly,
  onHasWarningsOnlyChange,
  selectedProcessIds,
  onProcessFilterChange,
  sortByUser,
  onSortByUserChange,
  selectedProjectIds,
  onProjectFilterChange,
  sortByProject,
  onSortByProjectChange,
  groupByProject,
  onGroupByProjectChange,
}: KanbanBoardControlsProps) {
  const [processMenuOpen, setProcessMenuOpen] = useState(false);

  const toggleValues = (() => {
    const values: string[] = [];
    if (!hideImages) values.push("images");
    if (sortByUser) values.push("sortByUser");
    if (sortByProject) values.push("sortByProject");
    if (groupByProject) values.push("groupByProject");
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
    if (values.includes("sortByProject") !== sortByProject)
      onSortByProjectChange(!sortByProject);
    if (values.includes("groupByProject") !== groupByProject)
      onGroupByProjectChange(!groupByProject);
  };

  const { data: processes = [] } = useQuery(processesQuery());

  const toggleProcess = (processId: string) => {
    const newIds = selectedProcessIds.includes(processId)
      ? selectedProcessIds.filter((id) => id !== processId)
      : [...selectedProcessIds, processId];
    onProcessFilterChange(newIds);
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ProjectFilter
        selectedIds={selectedProjectIds}
        onChange={onProjectFilterChange}
      />
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
                <ProcessIcon process={process} className="size-4" />
                {process.name}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant={hasWarningsOnly ? "secondary" : "outline"}
        size="sm"
        aria-pressed={hasWarningsOnly}
        onClick={() => onHasWarningsOnlyChange(!hasWarningsOnly)}
        className="gap-2"
      >
        <AlertTriangle className="size-4" aria-hidden="true" />
        Has warnings
      </Button>

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
        <ToggleGroupItem value="sortByProject" aria-label="Sort by project">
          <FolderKanban className="size-4" />
          <span className="hidden sm:inline">Sort by Project</span>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="groupByProject"
          aria-label="Group by project"
          disabled={isEditMode}
        >
          <Rows3 className="size-4" />
          <span className="hidden sm:inline">Group by Project</span>
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
