import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FolderKanban } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { projectsQuery, sortProjectsForDisplay } from "~/lib/api";

/** Multi-select project filter shared by the board and Done. */
export function ProjectFilter({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: projects = [] } = useQuery(projectsQuery());
  const sorted = sortProjectsForDisplay(projects);
  const active = sorted.filter((project) => !project.archived_at);
  // Archived projects stay filterable while they still have cards.
  const archived = sorted.filter(
    (project) => project.archived_at && project.card_count > 0
  );
  const toggle = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selected) => selected !== id)
        : [...selectedIds, id]
    );
  const item = (project: (typeof sorted)[number]) => (
    <DropdownMenuCheckboxItem
      key={project.id}
      checked={selectedIds.includes(project.id)}
      onCheckedChange={() => toggle(project.id)}
      onSelect={(event) => event.preventDefault()}
    >
      <span className="truncate">{project.name}</span>
    </DropdownMenuCheckboxItem>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FolderKanban className="size-4" aria-hidden="true" />
          {selectedIds.length > 0
            ? `Projects (${selectedIds.length})`
            : "Filter by Project"}
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-60 overflow-auto">
        {selectedIds.length > 0 && (
          <>
            <DropdownMenuItem onClick={() => onChange([])}>
              Show all
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {active.map(item)}
        {archived.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Archived
            </DropdownMenuLabel>
            {archived.map(item)}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
