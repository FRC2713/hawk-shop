import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { ProjectError, updateProject } from "~/server/projectsApi/projects";

/** Accepts `name` and/or `archived`. Projects are never deleted. */
export const PATCH: APIRoute = async ({ request, params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;
  try {
    const body = await request.json().catch(() => ({}));
    const project = updateProject(params.id!, {
      name: body?.name,
      archived: body?.archived,
    });
    return Response.json({ project });
  } catch (error) {
    if (error instanceof ProjectError)
      return Response.json({ error: error.message }, { status: error.status });
    const errorId = logServerError("PROJECTS", error);
    return Response.json(
      { error: "Failed to update project", errorId },
      { status: 500 }
    );
  }
};
