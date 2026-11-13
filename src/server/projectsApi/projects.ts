import "virtual:hawk-shop/server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "~/server/db/client";
import {
  kanbanCards,
  MISCELLANEOUS_PROJECT_ID,
  projects,
} from "~/server/db/schema";
import type { ProjectRow, ProjectWithUsage } from "~/server/db/types";
import { publishKanbanEvent } from "~/server/events/bus";
import type { SessionActor } from "~/lib/sessionActor";

export const PROJECT_NAME_MAX_LENGTH = 60;

/** A rejected project change, with the HTTP status the route should answer. */
export class ProjectError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}

function normalizeName(name: unknown) {
  if (typeof name !== "string") throw new ProjectError("Name is required", 400);
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new ProjectError("Name is required", 400);
  if (trimmed.length > PROJECT_NAME_MAX_LENGTH)
    throw new ProjectError(
      `Names are at most ${PROJECT_NAME_MAX_LENGTH} characters`,
      400
    );
  return trimmed;
}

function byName(name: string) {
  return db
    .select()
    .from(projects)
    .where(sql`lower(${projects.name}) = lower(${name})`)
    .get();
}

export function getProject(id: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

/**
 * Every project, archived ones included, with how many cards use it and when
 * `actorId` last released into it. Callers decide what to hide and how to order.
 */
export function listProjects(actorId: string | null): ProjectWithUsage[] {
  const usage = db
    .select({
      project_id: kanbanCards.project_id,
      card_count: sql<number>`count(*)`,
      last_used_by_me_at: sql<
        string | null
      >`max(case when ${kanbanCards.created_by} = ${actorId ?? ""} then ${kanbanCards.date_created} end)`,
    })
    .from(kanbanCards)
    .groupBy(kanbanCards.project_id)
    .all();
  const byProject = new Map(usage.map((row) => [row.project_id, row]));
  return db
    .select()
    .from(projects)
    .orderBy(asc(sql`lower(${projects.name})`))
    .all()
    .map((project) => ({
      ...project,
      card_count: byProject.get(project.id)?.card_count ?? 0,
      last_used_by_me_at: byProject.get(project.id)?.last_used_by_me_at ?? null,
    }));
}

/**
 * Create a project, or return the one already using that name in any case.
 * Asking for an archived project's name brings it back, since someone is
 * about to release into it.
 */
export function createProject(
  name: unknown,
  actor: SessionActor
): { project: ProjectRow; created: boolean } {
  const clean = normalizeName(name);
  const existing = byName(clean);
  if (existing) {
    if (!existing.archived_at) return { project: existing, created: false };
    const restored = db
      .update(projects)
      .set({ archived_at: null })
      .where(eq(projects.id, existing.id))
      .returning()
      .get();
    publishKanbanEvent({
      table: "projects",
      action: "update",
      id: existing.id,
    });
    return { project: restored, created: false };
  }
  const project = db
    .insert(projects)
    .values({
      id: `project-${crypto.randomUUID()}`,
      name: clean,
      created_by: actor.onshape_user_id,
    })
    .returning()
    .get();
  publishKanbanEvent({ table: "projects", action: "insert", id: project.id });
  return { project, created: true };
}

/** Rename and archive. Miscellaneous accepts neither. */
export function updateProject(
  id: string,
  changes: { name?: unknown; archived?: unknown }
): ProjectRow {
  const project = getProject(id);
  if (!project) throw new ProjectError("Project not found", 404);
  if (id === MISCELLANEOUS_PROJECT_ID)
    throw new ProjectError("Miscellaneous can't be renamed or archived", 400);
  const set: Partial<ProjectRow> = {};
  if (changes.name !== undefined) {
    const name = normalizeName(changes.name);
    const clash = byName(name);
    if (clash && clash.id !== id)
      throw new ProjectError(`A project named "${clash.name}" exists`, 409);
    set.name = name;
  }
  if (changes.archived !== undefined) {
    if (typeof changes.archived !== "boolean")
      throw new ProjectError("archived must be true or false", 400);
    set.archived_at = changes.archived
      ? (project.archived_at ?? new Date().toISOString())
      : null;
  }
  if (Object.keys(set).length === 0) return project;
  const updated = db
    .update(projects)
    .set(set)
    .where(eq(projects.id, id))
    .returning()
    .get();
  publishKanbanEvent({ table: "projects", action: "update", id });
  return updated;
}
