import { useMemo, type ReactNode, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search, X } from "lucide-react";
import { FilterMenu } from "~/components/mfg/FilterMenu";
import { ProjectFilter } from "~/components/mfg/ProjectFilter";
import { ProcessIcon } from "~/components/mfg/processes/ProcessIcon";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  equipmentQuery,
  kanbanCardsQuery,
  processesQuery,
  usersQuery,
} from "~/lib/api";
import {
  hasActiveFilters,
  NO_MACHINE,
  type BoardFilters,
  type BoardSort,
} from "~/lib/boardFilter";

const SORT_LABELS: Record<BoardSort, string> = {
  relevance: "Default",
  project: "Project",
  assignee: "Assignee",
};

/**
 * The board's one filter row: search, Project, Process, Machine, Submitter,
 * Has warnings and Sort, labelled and wrapping. `children` is the view
 * slot on the right (density, rows), which changes layout, not which cards
 * match.
 */
export function BoardFilterBar({
  filters,
  onChange,
  onClear,
  searchRef,
  children,
}: {
  filters: BoardFilters;
  onChange: (changes: Partial<BoardFilters>) => void;
  onClear: () => void;
  searchRef: Ref<HTMLInputElement>;
  children?: ReactNode;
}) {
  const { data: processes = [] } = useQuery(processesQuery());
  const { data: equipment = [] } = useQuery(equipmentQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const { data: cards = [] } = useQuery(kanbanCardsQuery());

  // Only people who released something on the board, plus any chosen in the URL.
  const submitters = useMemo(() => {
    const names = new Map(
      users.map((user) => [user.onshape_user_id, user.name])
    );
    const ids = new Set([
      ...cards.flatMap((card) => (card.created_by ? [card.created_by] : [])),
      ...filters.submitterIds,
    ]);
    return [...ids]
      .map((id) => ({ id, name: names.get(id) || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, cards, filters.submitterIds]);

  const machines = useMemo(
    () =>
      [...equipment]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, name }) => ({ id, name })),
    [equipment]
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="search"
        aria-label="Board filters"
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative w-64 max-w-full">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search parts"
            aria-keyshortcuts="/"
            placeholder="Search parts ( / )"
            value={filters.q}
            onChange={(event) => onChange({ q: event.target.value })}
            className="h-8 pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {filters.q && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-0 size-8 -translate-y-1/2"
              onClick={() => onChange({ q: "" })}
              title="Clear search"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        <ProjectFilter
          selectedIds={filters.projectIds}
          onChange={(projectIds) => onChange({ projectIds })}
        />
        <FilterMenu
          label="Process"
          emptyText="No processes"
          selectedIds={filters.processIds}
          onChange={(processIds) => onChange({ processIds })}
          groups={[
            {
              options: processes.map((process) => ({
                id: process.id,
                name: process.name,
                icon: <ProcessIcon process={process} className="size-4" />,
              })),
            },
          ]}
        />
        <FilterMenu
          label="Machine"
          selectedIds={filters.machineIds}
          onChange={(machineIds) => onChange({ machineIds })}
          groups={[
            { options: [{ id: NO_MACHINE, name: "No machine" }] },
            { options: machines },
          ]}
        />
        <FilterMenu
          label="Submitter"
          emptyText="No one has released a part"
          selectedIds={filters.submitterIds}
          onChange={(submitterIds) => onChange({ submitterIds })}
          groups={[{ options: submitters }]}
        />
        <Button
          variant="outline"
          size="sm"
          aria-pressed={filters.warnings}
          onClick={() => onChange({ warnings: !filters.warnings })}
          className="aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground/90 aria-pressed:hover:text-background gap-2"
        >
          <AlertTriangle className="size-4" aria-hidden="true" />
          Has warnings
        </Button>
        <Select
          value={filters.sort}
          onValueChange={(sort) => onChange({ sort: sort as BoardSort })}
        >
          <SelectTrigger size="sm" aria-label="Sort" className="gap-1">
            <span className="text-muted-foreground">Sort:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters(filters) && (
          <Button variant="outline" size="sm" onClick={onClear}>
            <X className="size-4" aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>
      {children && (
        <div
          role="group"
          aria-label="View"
          className="ml-auto flex flex-wrap items-center gap-2"
        >
          {children}
        </div>
      )}
    </div>
  );
}
