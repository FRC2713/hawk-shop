import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { createCard, getCards } from "~/lib/kanbanApi/cards";

export const Route = createFileRoute("/api/kanban/cards/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const columnId = new URL(request.url).searchParams.get("columnId");

          const result = await getCards();

          if (result.error) {
            console.error("[KANBAN CARDS] Error loading cards:", result.error);
            return Response.json(
              { cards: [], error: result.error },
              { status: 500 }
            );
          }

          let cards = result.cards;

          // Filter by columnId if provided
          if (columnId) {
            cards = cards.filter((card) => card.column_id === columnId);
          }

          return Response.json({ cards });
        } catch (error) {
          console.error("[KANBAN CARDS] Error loading cards:", error);
          return Response.json({ cards: [] }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const body = await request.json();

          // Validate required field (only title is required)
          if (!body.title) {
            return Response.json(
              { error: "Missing required field: title" },
              { status: 400 }
            );
          }

          // Create the card
          const newCard = await createCard({
            id: body.id,
            title: body.title,
            imageUrl: body.imageUrl,
            assignee: body.assignee,
            machine: body.machine,
            dueDate: body.dueDate,
            content: body.content,
            processIds: body.processIds || [],
            createdBy: body.createdBy,
          });

          return Response.json({ card: newCard }, { status: 201 });
        } catch (error) {
          console.error("[KANBAN CARDS] Error creating card:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to create card";
          return Response.json({ error: errorMessage }, { status: 500 });
        }
      },
    },
  },
});
