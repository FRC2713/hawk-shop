import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { getProcessById } from "~/server/processesApi/processes";
import { getProcessQueue } from "~/server/kanbanApi/queues";

/** A process queue: Backlog parts with this process and no machine. */
export const GET: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const process = await getProcessById(params.id!);
    if (!process)
      return Response.json({ error: "Process not found" }, { status: 404 });
    return Response.json({ process, cards: await getProcessQueue(process.id) });
  } catch (error) {
    const errorId = logServerError("PROCESS QUEUE", error);
    return Response.json(
      { error: "Failed to load queue", errorId },
      { status: 500 }
    );
  }
};
