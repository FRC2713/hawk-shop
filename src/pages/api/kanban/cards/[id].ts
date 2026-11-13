import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { getSessionActor, requireSessionActor } from "~/lib/sessionActor";
import { requireAuth } from "~/lib/requireAuth";
import {
  deleteCard,
  getCards,
  getCardStatusHistory,
  UnknownProjectError,
  updateCard,
  setCardProcesses,
} from "~/server/kanbanApi/cards";
import { deleteCardImage } from "~/server/kanbanApi/images";

export const GET: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
  try {
    const result = await getCards();

    if (result.error) {
      const errorId =
        result.errorId ??
        logServerError("KANBAN CARD", new Error(result.error));
      return Response.json({ error: result.error, errorId }, { status: 500 });
    }

    const card = result.cards.find((c) => c.id === id);

    if (!card) {
      return Response.json({ error: "Card not found" }, { status: 404 });
    }

    return Response.json({
      card: { ...card, status_history: await getCardStatusHistory(id) },
    });
  } catch (error) {
    const errorId = logServerError("KANBAN CARD", error);
    return Response.json(
      { error: "Failed to load card", errorId },
      { status: 500 }
    );
  }
};
export const PATCH: APIRoute = async ({ request, params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  const id = params.id!;
  try {
    const body = await request.json();
    const { processIds, ...updates } = body;

    const updatedCard = await updateCard(id, updates, actor);

    // Update processes if provided
    if (processIds !== undefined) {
      await setCardProcesses(id, processIds || []);
    }

    // Fetch the updated card with processes
    const result = await getCards();
    const cardWithProcesses = result.cards.find((c) => c.id === id);

    return Response.json({ card: cardWithProcesses || updatedCard });
  } catch (error) {
    if (error instanceof UnknownProjectError)
      return Response.json({ error: error.message }, { status: 400 });
    const errorId = logServerError("KANBAN CARD", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Card not found" ? 404 : 500;
    return Response.json(
      { error: errorMessage, errorId },
      { status: statusCode }
    );
  }
};
export const DELETE: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
  try {
    const deletedCard = await deleteCard(id, await getSessionActor());
    // Self-hosted installs own their disk, so reclaim the card's image too.
    await deleteCardImage(deletedCard.image_url);
    return Response.json({ card: deletedCard });
  } catch (error) {
    const errorId = logServerError("KANBAN CARD", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Card not found" ? 404 : 500;
    return Response.json(
      { error: errorMessage, errorId },
      { status: statusCode }
    );
  }
};
