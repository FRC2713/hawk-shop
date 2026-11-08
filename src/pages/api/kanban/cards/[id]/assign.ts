import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { updateCard } from "~/server/kanbanApi/cards";

export const POST: APIRoute = async ({ request, params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const id = params.id!;
  const { assignee } = await request.json();

  console.log(`Assigning card ${id} to user ${assignee}`);
  const updatedCard = await updateCard(id, {
    assignee,
  });
  return Response.json({ card: updatedCard });
};
