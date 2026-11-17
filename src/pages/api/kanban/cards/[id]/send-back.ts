import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { sendBack } from "~/server/kanbanApi/workflow";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

/**
 * Send a part back from Review. Body: `{ reason: string }`, required and
 * non-empty. The part returns to In Progress if it has an assignee, otherwise
 * to Backlog, and the reason is kept as a review note.
 */
export const POST: APIRoute = async ({ request, params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  try {
    const body = await request.json().catch(() => ({}));
    const card = await sendBack(params.id!, actor, { reason: body?.reason });
    return Response.json({ card });
  } catch (error) {
    return workflowErrorResponse("SEND BACK CARD", error);
  }
};
