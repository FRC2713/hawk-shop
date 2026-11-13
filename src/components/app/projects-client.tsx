import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
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
  const update = useMutation({
    mutationFn: (changes: { name?: string; archived?: boolean }) =>
      updateProject(project.id, changes),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
    },
    onError: (error) =>
      toast.error("Couldn't update the project", {
        description: <ErrorMessage error={error} />,
      }),
  });

  return (
    <li className="bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
      <FolderKanban
        className="size-4 shrink-0 text-[var(--hawk-teal)]"
        aria-hidden="true"
      />
      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
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
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={update.isPending}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setName(project.name);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <a
            href={boardLink(project)}
            className="font-heading truncate font-semibold hover:underline"
          >
            {project.name}
          </a>
          {builtIn && <Badge variant="secondary">Built in</Badge>}
          {project.archived_at && <Badge variant="outline">Archived</Badge>}
        </div>
      )}
      <span className="text-muted-foreground text-sm tabular-nums">
        {project.card_count} card{project.card_count === 1 ? "" : "s"}
      </span>
      {!builtIn && !editing && (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            aria-label={`Rename ${project.name}`}
          >
            <Pencil className="size-4" />
            <span className="hidden sm:inline">Rename</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={update.isPending}
            onClick={() => update.mutate({ archived: !project.archived_at })}
            aria-label={`${project.archived_at ? "Restore" : "Archive"} ${project.name}`}
          >
            {project.archived_at ? (
              <ArchiveRestore className="size-4" />
            ) : (
              <Archive className="size-4" />
            )}
            <span className="hidden sm:inline">
              {project.archived_at ? "Restore" : "Archive"}
            </span>
          </Button>
        </div>
      )}
    </li>
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
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground text-sm">
            Every released part belongs to one project. Use Miscellaneous for
            one-off parts. Archiving a project hides it when releasing; its
            cards keep it.
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
          />
          <Button type="submit" disabled={!newName.trim() || create.isPending}>
            <Plus className="size-4" />
            Add project
          </Button>
        </form>
        {error ? (
          <ErrorDisplay error={error} />
        ) : isLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            <section aria-labelledby="active-projects" className="space-y-2">
              <h2 id="active-projects" className="font-heading font-semibold">
                Active
              </h2>
              <ul className="flex flex-col gap-2">
                {active.map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </ul>
            </section>
            {archived.length > 0 && (
              <section
                aria-labelledby="archived-projects"
                className="space-y-2"
              >
                <h2
                  id="archived-projects"
                  className="font-heading font-semibold"
                >
                  Archived
                </h2>
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
    </main>
  );
}
