import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderKanban,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorDisplay, ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import {
  createProject,
  MISCELLANEOUS_PROJECT_ID,
  projectsQuery,
  queryKeys,
  sortProjectsForDisplay,
  updateProject,
  type ProjectWithUsage,
} from "~/lib/api";

function boardLink(project: ProjectWithUsage) {
  return `/kanban?project=${encodeURIComponent(project.id)}`;
}

function ProjectRow({ project }: { project: ProjectWithUsage }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const builtIn = project.id === MISCELLANEOUS_PROJECT_ID;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
    queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
  };
  const reportError = (error: Error) =>
    toast.error("Couldn't update the project", {
      description: <ErrorMessage error={error} />,
    });
  const update = useMutation({
    mutationFn: (changes: { name?: string; archived?: boolean }) =>
      updateProject(project.id, changes),
    onSuccess: (_data, changes) => {
      setEditing(false);
      refresh();
      if (changes.archived === undefined) return;
      // The row moves to the other list (and remounts), so the undo calls
      // the API directly instead of this row's mutation.
      const undo = !changes.archived;
      toast.success(
        `${changes.archived ? "Archived" : "Restored"} ${project.name}`,
        {
          action: {
            label: "Undo",
            onClick: () =>
              updateProject(project.id, { archived: undo }).then(() => {
                toast.success(
                  `${undo ? "Archived" : "Restored"} ${project.name}`
                );
                refresh();
              }, reportError),
          },
        }
      );
    },
    onError: reportError,
  });
  const archiveLabel = project.archived_at ? "Restore" : "Archive";
  const cardCount = (
    <span className="text-muted-foreground shrink-0 text-sm sm:w-20 sm:text-right">
      <span className="brand-figures">{project.card_count}</span> card
      {project.card_count === 1 ? "" : "s"}
    </span>
  );

  if (editing)
    return (
      <li className="bg-card flex min-h-14 items-center gap-3 rounded-lg border px-4 py-2">
        <FolderKanban
          className="text-muted-foreground size-4 shrink-0 max-sm:hidden dark:text-[var(--hawk-teal)]"
          aria-hidden="true"
        />
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && name.trim() !== project.name)
              update.mutate({ name });
            else setEditing(false);
          }}
        >
          <Input
            autoFocus
            aria-label={`New name for ${project.name}`}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setName(project.name);
                setEditing(false);
              }
            }}
            className="h-11 min-w-0 flex-1 max-sm:basis-full sm:h-9"
          />
          <Button
            type="submit"
            className="h-11 max-sm:flex-1 sm:h-9"
            disabled={update.isPending}
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 max-sm:flex-1 sm:h-9"
            onClick={() => {
              setName(project.name);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      </li>
    );

  return (
    <li className="bg-card hover:bg-accent/60 relative flex min-h-14 items-center gap-2 rounded-lg border px-4 py-1.5 transition-colors sm:gap-3">
      <FolderKanban
        className="text-muted-foreground size-4 shrink-0 dark:text-[var(--hawk-teal)]"
        aria-hidden="true"
      />
      {/* Phone: the count sits under the name. Wider: a right-aligned column. */}
      <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
        {/* The link covers the whole row; the action buttons sit above it. */}
        <a
          href={boardLink(project)}
          className="font-heading focus-visible:ring-ring inline-flex min-w-0 items-center gap-1 self-start rounded-sm font-semibold outline-none after:absolute after:inset-0 after:rounded-lg hover:underline focus-visible:ring-2 sm:mr-auto sm:self-auto"
        >
          <span className="truncate">{project.name}</span>
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        </a>
        {cardCount}
      </div>
      <div className="relative z-10 flex w-[5.75rem] shrink-0 justify-end gap-1 sm:w-48">
        {builtIn ? (
          <Badge variant="secondary" className="self-center">
            Built in
          </Badge>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="max-sm:size-11"
              onClick={() => setEditing(true)}
              aria-label={`Rename ${project.name}`}
            >
              <Pencil className="size-4" />
              <span className="hidden sm:inline">Rename</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="max-sm:size-11"
              disabled={update.isPending}
              onClick={() => update.mutate({ archived: !project.archived_at })}
              aria-label={`${archiveLabel} ${project.name}`}
              title={
                project.archived_at
                  ? "Make this project pickable when releasing again"
                  : "Archived projects can't be picked when releasing. Their cards stay put."
              }
            >
              {project.archived_at ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              <span className="hidden sm:inline">{archiveLabel}</span>
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function SectionHeading({
  id,
  label,
  count,
}: {
  id: string;
  label: string;
  count: number;
}) {
  return (
    <h2
      id={id}
      className="font-heading text-muted-foreground text-sm font-semibold tracking-wide uppercase"
    >
      {label} · <span className="brand-figures">{count}</span>
    </h2>
  );
}

/**
 * Every project, with rename and archive. Projects are never deleted, so
 * cards always keep theirs; archiving only takes one out of the release picker.
 */
export function ProjectsClient() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const { data: projects = [], isLoading, error } = useQuery(projectsQuery());
  const create = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      setNewName("");
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
    },
    onError: (error) =>
      toast.error("Couldn't create the project", {
        description: <ErrorMessage error={error} />,
      }),
  });
  const sorted = sortProjectsForDisplay(projects);
  const active = sorted.filter((project) => !project.archived_at);
  const archived = sorted.filter((project) => project.archived_at);

  return (
    <main className="bg-background flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-5 py-4 sm:py-6">
        <div className="flex max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
            <p className="text-muted-foreground text-sm text-pretty">
              Projects group released parts on the board. Open one to see its
              cards. Use Miscellaneous for one&#8209;off parts.
            </p>
          </header>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (newName.trim()) create.mutate(newName);
            }}
          >
            <Input
              aria-label="New project name"
              placeholder="New project name"
              value={newName}
              maxLength={60}
              onChange={(event) => setNewName(event.target.value)}
              className="bg-card h-11 sm:h-9"
            />
            <Button
              type="submit"
              className="h-11 sm:h-9"
              disabled={!newName.trim() || create.isPending}
            >
              <Plus className="size-4" />
              Add project
            </Button>
          </form>
          {error ? (
            <ErrorDisplay error={error} />
          ) : isLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              <section aria-labelledby="active-projects" className="space-y-3">
                <SectionHeading
                  id="active-projects"
                  label="Active"
                  count={active.length}
                />
                <ul className="flex flex-col gap-2">
                  {active.map((project) => (
                    <ProjectRow key={project.id} project={project} />
                  ))}
                </ul>
              </section>
              {archived.length > 0 && (
                <section
                  aria-labelledby="archived-projects"
                  className="space-y-3"
                >
                  <div className="flex flex-col gap-1">
                    <SectionHeading
                      id="archived-projects"
                      label="Archived"
                      count={archived.length}
                    />
                    <p className="text-muted-foreground text-sm">
                      These can't be picked when releasing. Their cards stay
                      put.
                    </p>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {archived.map((project) => (
                      <ProjectRow key={project.id} project={project} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
