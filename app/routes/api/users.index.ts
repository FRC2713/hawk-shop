import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { listUsers } from "~/lib/db/users";

export const Route = createFileRoute("/api/users/")({
  server: {
    handlers: {
      GET: async () => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          return Response.json(await listUsers());
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to list users";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
