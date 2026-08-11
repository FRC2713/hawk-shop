import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { updateCard } from "~/lib/kanbanApi/cards";

export const Route = createFileRoute("/api/kanban/cards/$id/assign")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        const { id } = params;
        const { assignee } = await request.json();

        console.log(`Assigning card ${id} to user ${assignee}`);
        const updatedCard = await updateCard(id, {
          assignee,
        });
        return Response.json({ card: updatedCard });
      },
    },
  },
});
