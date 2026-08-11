import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { createProcess, getProcesses } from "~/lib/processesApi/processes";

export const Route = createFileRoute("/api/processes/")({
  server: {
    handlers: {
      GET: async () => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const result = await getProcesses();

          if (result.error) {
            console.error("[PROCESSES] Error loading processes:", result.error);
            return Response.json(
              { processes: [], error: result.error },
              { status: 500 }
            );
          }

          return Response.json({ processes: result.processes });
        } catch (error) {
          console.error("[PROCESSES] Error loading processes:", error);
          return Response.json({ processes: [] }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
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
          console.error("[PROCESSES] Error creating process:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to create process";
          return Response.json({ error: errorMessage }, { status: 500 });
        }
      },
    },
  },
});
