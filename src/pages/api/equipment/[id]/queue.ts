import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { getMachineQueue } from "~/server/kanbanApi/queues";
import { MachineNotFoundError } from "~/server/kanbanApi/workflowErrors";

/**
 * A machine's queue: Backlog parts assigned to it, then Backlog parts with no
 * machine that it can make.
 */
export const GET: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    return Response.json(await getMachineQueue(params.id!));
  } catch (error) {
    if (error instanceof MachineNotFoundError)
      return Response.json({ error: error.message }, { status: 404 });
    const errorId = logServerError("MACHINE QUEUE", error);
    return Response.json(
      { error: "Failed to load queue", errorId },
      { status: 500 }
    );
  }
};
