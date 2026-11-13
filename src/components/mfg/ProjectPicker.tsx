import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  createProject,
  projectsQuery,
  queryKeys,
  sortProjectsForPicker,
} from "~/lib/api";
import { cn } from "~/lib/utils";

const normalize = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Choose one project, or type a new name to create it. Lists the member's
 * recent projects first and Miscellaneous last; archived projects are hidden
 * unless already selected.
 */
export function ProjectPicker({
  id,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id?: string;
  value: string | null;
  onChange: (projectId: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: projects = [] } = useQuery(projectsQuery());

  const selected = projects.find((project) => project.id === value);
  const options = useMemo(() => {
    const wanted = normalize(query);
    return sortProjectsForPicker(projects).filter(
      (project) => !wanted || normalize(project.name).includes(wanted)
    );
  }, [projects, query]);
  const exact = projects.some(
    (project) => normalize(project.name) === normalize(query)
  );
  const canCreate = query.trim().length > 0 && !exact;

  const create = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
      choose(project.id);
    },
  });

  function choose(projectId: string) {
    onChange(projectId);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const match = projects.find(
      (project) => normalize(project.name) === normalize(query)
    );
    if (match) choose(match.id);
    else if (canCreate) create.mutate(query);
    else if (options[0]) choose(options[0].id);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground"
          )}
        >
          <span className="truncate">
            {selected ? selected.name : "Choose a project…"}
          </span>
          <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
        align="start"
        // Radix focuses the panel itself; typing should go to the search.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          aria-label="Find or create a project"
          placeholder="Find or create a project…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={60}
          className="w-full border-b bg-transparent px-3 py-2 text-sm outline-none"
        />
        <div id={listId} role="listbox" className="max-h-60 overflow-auto p-1">
          {options.map((project) => (
            <button
              key={project.id}
              type="button"
              role="option"
              aria-selected={project.id === value}
              onClick={() => choose(project.id)}
              className="hover:bg-accent hover:text-accent-foreground flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none"
            >
              <CheckIcon
                className={cn(
                  "mr-2 size-4",
                  project.id === value ? "opacity-100" : "opacity-0"
                )}
                aria-hidden="true"
              />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onClick={() => create.mutate(query)}
              disabled={create.isPending}
              className="hover:bg-accent hover:text-accent-foreground flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none"
            >
              <PlusIcon className="mr-2 size-4" aria-hidden="true" />
              <span className="truncate">Create “{query.trim()}”</span>
            </button>
          )}
          {options.length === 0 && !canCreate && (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">
              No projects yet
            </p>
          )}
          {create.error && (
            <p className="text-destructive px-2 py-1.5 text-xs">
              {create.error.message}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
