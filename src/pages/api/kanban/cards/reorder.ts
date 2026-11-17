import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { reorderMachineQueue } from "~/server/kanbanApi/workflow";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

/**
 * Reorder a machine's queue. Body: `{ machineId: string, cardIds: string[] }`;
 * the listed parts go first in that order, the rest follow in the default
 * order, and an empty list resets it. Answers the machine's queue as
 * `GET /api/equipment/:id/queue` does.
 */
export const POST: APIRoute = async ({ request }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  try {
    const body = await request.json().catch(() => ({}));
    return Response.json(
      await reorderMachineQueue(body?.machineId, {
        cardIds: body?.cardIds,
      })
    );
  } catch (error) {
    return workflowErrorResponse("REORDER QUEUE", error);
  }
};
