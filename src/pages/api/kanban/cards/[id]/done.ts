import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { done } from "~/server/kanbanApi/workflow";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

/** Mark a part done: move it from In Progress to Review. No body. */
export const POST: APIRoute = async ({ params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  try {
    return Response.json({ card: await done(params.id!, actor) });
  } catch (error) {
    return workflowErrorResponse("DONE CARD", error);
  }
};
