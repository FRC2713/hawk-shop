import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import {
  createProject,
  listProjects,
  ProjectError,
} from "~/server/projectsApi/projects";

export const GET: APIRoute = async () => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;
  try {
    return Response.json({ projects: listProjects(actor.onshape_user_id) });
  } catch (error) {
    const errorId = logServerError("PROJECTS", error);
    return Response.json({ projects: [], errorId }, { status: 500 });
  }
};

/** Creates a project, or returns the existing one with that name (201 vs 200). */
export const POST: APIRoute = async ({ request }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;
  try {
    const body = await request.json().catch(() => ({}));
    const { project, created } = createProject(body?.name, actor);
    return Response.json({ project }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ProjectError)
      return Response.json({ error: error.message }, { status: error.status });
    const errorId = logServerError("PROJECTS", error);
    return Response.json(
      { error: "Failed to create project", errorId },
      { status: 500 }
    );
  }
};
