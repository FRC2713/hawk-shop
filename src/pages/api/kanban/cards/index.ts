import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { requireAuth } from "~/lib/requireAuth";
import {
  createCard,
  getCards,
  UnknownProjectError,
} from "~/server/kanbanApi/cards";

export const GET: APIRoute = async ({ request }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const columnId = new URL(request.url).searchParams.get("columnId");

    const result = await getCards();

    if (result.error) {
      const errorId =
        result.errorId ??
        logServerError("KANBAN CARDS", new Error(result.error));
      return Response.json(
        { cards: [], error: result.error, errorId },
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
    const errorId = logServerError("KANBAN CARDS", error);
    return Response.json({ cards: [], errorId }, { status: 500 });
  }
};
export const POST: APIRoute = async ({ request }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

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
    const newCard = await createCard(
      {
        id: body.id,
        title: body.title,
        imageUrl: body.imageUrl,
        assignee: body.assignee,
        machine: body.machine,
        dueDate: body.dueDate,
        content: body.content,
        processIds: body.processIds || [],
        projectId: body.projectId,
      },
      actor
    );

    return Response.json({ card: newCard }, { status: 201 });
  } catch (error) {
    if (error instanceof UnknownProjectError)
      return Response.json({ error: error.message }, { status: 400 });
    const errorId = logServerError("KANBAN CARDS", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create card";
    return Response.json({ error: errorMessage, errorId }, { status: 500 });
  }
};
