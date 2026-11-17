import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { unclaim } from "~/server/kanbanApi/workflow";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

/** Unclaim a part: clear its assignee and return it to Backlog. No body. */
export const POST: APIRoute = async ({ params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  try {
    return Response.json({ card: await unclaim(params.id!, actor) });
  } catch (error) {
    return workflowErrorResponse("UNCLAIM CARD", error);
  }
};
