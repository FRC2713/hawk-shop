import { createFileRoute } from "@tanstack/react-router";
import { requireSessionActor } from "~/lib/sessionActor";
import { updateCard } from "~/lib/kanbanApi/cards";

export const Route = createFileRoute("/api/kanban/cards/$id/assign")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const actor = await requireSessionActor();
        if (actor instanceof Response) return actor;

        const { id } = params;
        const { assignee } = await request.json();

        console.log(`Assigning card ${id} to user ${assignee}`);
        const updatedCard = await updateCard(
          id,
          {
            assignee,
          },
          actor
        );
        return Response.json({ card: updatedCard });
      },
    },
  },
});
