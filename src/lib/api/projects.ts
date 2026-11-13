import { queryOptions } from "@tanstack/react-query";
import type { ProjectRow, ProjectWithUsage } from "~/server/db/types";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

export type { ProjectRow, ProjectWithUsage };

/** Mirrors the server constant; client code can't import the schema module. */
export const MISCELLANEOUS_PROJECT_ID = "project-miscellaneous";

/** All projects, archived included, alphabetical. */
export function projectsQuery() {
  return queryOptions({
    queryKey: queryKeys.projects.all(),
    queryFn: async () => {
      const { projects } = await apiFetch<{ projects: ProjectWithUsage[] }>(
        "/api/projects",
        { fallbackError: "Failed to fetch projects" }
      );
      return projects;
    },
    staleTime: 60 * 1000,
  });
}

/** Returns the existing project when the name is already taken in any case. */
export async function createProject(name: string): Promise<ProjectRow> {
  const { project } = await apiFetch<{ project: ProjectRow }>("/api/projects", {
    method: "POST",
    json: { name: name.trim() },
    fallbackError: "Failed to create project",
  });
  return project;
}

export async function updateProject(
  id: string,
  changes: { name?: string; archived?: boolean }
): Promise<ProjectRow> {
  const { project } = await apiFetch<{ project: ProjectRow }>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      json: changes,
      fallbackError: "Failed to update project",
    }
  );
  return project;
}

const compareNames = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Alphabetical, with Miscellaneous last: the order of lanes and filters. */
export function sortProjectsForDisplay<T extends { id: string; name: string }>(
  projects: readonly T[]
): T[] {
  return [...projects].sort((a, b) =>
    a.id === MISCELLANEOUS_PROJECT_ID
      ? 1
      : b.id === MISCELLANEOUS_PROJECT_ID
        ? -1
        : compareNames(a, b)
  );
}

/**
 * The release picker: active projects only, the member's recently used ones
 * first (newest first), then the rest alphabetically, Miscellaneous last.
 */
export function sortProjectsForPicker(
  projects: readonly ProjectWithUsage[]
): ProjectWithUsage[] {
  const active = projects.filter(
    (project) => !project.archived_at && project.id !== MISCELLANEOUS_PROJECT_ID
  );
  const recent = active
    .filter((project) => project.last_used_by_me_at)
    .sort((a, b) => b.last_used_by_me_at!.localeCompare(a.last_used_by_me_at!));
  const rest = active
    .filter((project) => !project.last_used_by_me_at)
    .sort(compareNames);
  const misc = projects.filter(
    (project) => project.id === MISCELLANEOUS_PROJECT_ID
  );
  return [...recent, ...rest, ...misc];
}
