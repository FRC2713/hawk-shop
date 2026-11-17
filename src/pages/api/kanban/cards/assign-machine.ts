import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { assignMachine } from "~/server/kanbanApi/workflow";
import { workflowErrorResponse } from "~/server/kanbanApi/workflowResponses";

/**
 * Assign one or more cards to a machine. Body:
 * `{ cardIds: string[], machineId: string | null }`; null returns the cards to
 * their process queue.
 */
export const POST: APIRoute = async ({ request }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  try {
    const body = await request.json().catch(() => ({}));
    const cards = await assignMachine(body?.cardIds, actor, {
      machineId: body?.machineId ?? null,
    });
    return Response.json({ cards });
  } catch (error) {
    return workflowErrorResponse("ASSIGN MACHINE", error);
  }
};
