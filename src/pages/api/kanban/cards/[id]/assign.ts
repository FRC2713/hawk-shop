import type { APIRoute } from "astro";
import { requireSessionActor } from "~/lib/sessionActor";
import { updateCard } from "~/server/kanbanApi/cards";

export const POST: APIRoute = async ({ request, params }) => {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;

  const id = params.id!;
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
};
