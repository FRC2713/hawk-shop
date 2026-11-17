import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { approve } from "~/server/kanbanApi/workflow";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

/** Approve a reviewed part: move it from Review to Done. No body. */
export const POST: APIRoute = async ({ params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  try {
    return Response.json({ card: await approve(params.id!, actor) });
  } catch (error) {
    return workflowErrorResponse("APPROVE CARD", error);
  }
};
