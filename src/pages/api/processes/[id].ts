import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import {
  getProcessById,
  updateProcess,
  deleteProcess,
} from "~/server/processesApi/processes";

export const GET: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const process = await getProcessById(params.id!);

    if (!process) {
      return Response.json({ error: "Process not found" }, { status: 404 });
    }

    return Response.json({ process });
  } catch (error) {
    const errorId = logServerError("PROCESSES", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to fetch process";
    return Response.json({ error: errorMessage, errorId }, { status: 500 });
  }
};
export const PUT: APIRoute = async ({ request, params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();

    // Build updates object
    const updates: {
      name?: string;
      description?: string | null;
    } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        return Response.json(
          { error: "Name must be a non-empty string" },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    if (body.description !== undefined) {
      updates.description = body.description || null;
    }

    const updatedProcess = await updateProcess(params.id!, updates);
    return Response.json({ process: updatedProcess });
  } catch (error) {
    const errorId = logServerError("PROCESSES", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to update process";
    return Response.json({ error: errorMessage, errorId }, { status: 500 });
  }
};
export const DELETE: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const deletedProcess = await deleteProcess(params.id!);
    return Response.json({ process: deletedProcess });
  } catch (error) {
    const errorId = logServerError("PROCESSES", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to delete process";
    return Response.json({ error: errorMessage, errorId }, { status: 500 });
  }
};
