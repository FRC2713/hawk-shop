import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import {
  getProcessById,
  updateProcess,
  deleteProcess,
} from "~/lib/processesApi/processes";

export const Route = createFileRoute("/api/processes/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const process = await getProcessById(params.id);

          if (!process) {
            return Response.json(
              { error: "Process not found" },
              { status: 404 }
            );
          }

          return Response.json({ process });
        } catch (error) {
          console.error("[PROCESSES] Error fetching process:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to fetch process";
          return Response.json({ error: errorMessage }, { status: 500 });
        }
      },

      PUT: async ({ request, params }) => {
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

          const updatedProcess = await updateProcess(params.id, updates);
          return Response.json({ process: updatedProcess });
        } catch (error) {
          console.error("[PROCESSES] Error updating process:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to update process";
          return Response.json({ error: errorMessage }, { status: 500 });
        }
      },

      DELETE: async ({ params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const deletedProcess = await deleteProcess(params.id);
          return Response.json({ process: deletedProcess });
        } catch (error) {
          console.error("[PROCESSES] Error deleting process:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to delete process";
          return Response.json({ error: errorMessage }, { status: 500 });
        }
      },
    },
  },
});
