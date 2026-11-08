import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import {
  deleteCard,
  getCards,
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
      console.error("[KANBAN CARD] Error loading cards:", result.error);
      return Response.json({ error: result.error }, { status: 500 });
    }

    const card = result.cards.find((c) => c.id === id);

    if (!card) {
      return Response.json({ error: "Card not found" }, { status: 404 });
    }

    return Response.json({ card });
  } catch (error) {
    console.error("[KANBAN CARD] Error loading card:", error);
    return Response.json({ error: "Failed to load card" }, { status: 500 });
  }
};
export const PATCH: APIRoute = async ({ request, params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
  try {
    const body = await request.json();
    const { processIds, created_by: _submitter, ...updates } = body;

    const updatedCard = await updateCard(id, updates);

    // Update processes if provided
    if (processIds !== undefined) {
      await setCardProcesses(id, processIds || []);
    }

    // Fetch the updated card with processes
    const result = await getCards();
    const cardWithProcesses = result.cards.find((c) => c.id === id);

    return Response.json({ card: cardWithProcesses || updatedCard });
  } catch (error) {
    console.error("[KANBAN CARD] Error in action:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Card not found" ? 404 : 500;
    return Response.json({ error: errorMessage }, { status: statusCode });
  }
};
export const DELETE: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
  try {
    const deletedCard = await deleteCard(id);
    // Self-hosted installs own their disk, so reclaim the card's image too.
    await deleteCardImage(deletedCard.image_url);
    return Response.json({ card: deletedCard });
  } catch (error) {
    console.error("[KANBAN CARD] Error in action:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Operation failed";
    const statusCode =
      error instanceof Error && error.message === "Card not found" ? 404 : 500;
    return Response.json({ error: errorMessage }, { status: statusCode });
  }
};
