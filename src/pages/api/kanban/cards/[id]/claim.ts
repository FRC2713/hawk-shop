import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { claim } from "~/server/kanbanApi/workflow";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

/**
 * Claim a part. Body (optional): `{ machineId?: string, userId?: string }`.
 * `userId` names the member who becomes the assignee (a shared station
 * screen); without it the signed-in member does. `machineId` links a
 * process-queue part to the machine it is claimed at.
 */
export const POST: APIRoute = async ({ request, params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  try {
    const body = await request.json().catch(() => ({}));
    const card = await claim(params.id!, actor, {
      machineId: body?.machineId ?? undefined,
      userId: body?.userId ?? undefined,
    });
    return Response.json({ card });
  } catch (error) {
    return workflowErrorResponse("CLAIM CARD", error);
  }
};
