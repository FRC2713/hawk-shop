import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { createProcess, getProcesses } from "~/server/processesApi/processes";

export const GET: APIRoute = async () => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const result = await getProcesses();

    if (result.error) {
      const errorId =
        result.errorId ?? logServerError("PROCESSES", new Error(result.error));
      return Response.json(
        { processes: [], error: result.error, errorId },
        { status: 500 }
      );
    }

    return Response.json({ processes: result.processes });
  } catch (error) {
    const errorId = logServerError("PROCESSES", error);
    return Response.json({ processes: [], errorId }, { status: 500 });
  }
};
export const POST: APIRoute = async ({ request }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();

    // Validate required field (name is required)
    if (
      !body.name ||
      typeof body.name !== "string" ||
      body.name.trim() === ""
    ) {
      return Response.json(
        { error: "Missing required field: name" },
        { status: 400 }
      );
    }

    // Create the process
    const newProcess = await createProcess({
      id: body.id,
      name: body.name.trim(),
      description: body.description,
    });

    return Response.json({ process: newProcess }, { status: 201 });
  } catch (error) {
    const errorId = logServerError("PROCESSES", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create process";
    return Response.json({ error: errorMessage, errorId }, { status: 500 });
  }
};
