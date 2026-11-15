import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { backfillCardSnapshot } from "~/server/kanbanApi/cardSnapshot";

/**
 * Fill a card's Onshape snapshot (material and version name) if it predates
 * snapshots, and return it. Cards released since snapshots existed answer from
 * their row without calling Onshape; an Onshape failure answers unknown values
 * (null) rather than an error so card details still open.
 */
export const POST: APIRoute = async ({ params }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    return Response.json(await backfillCardSnapshot(params.id!));
  } catch (error) {
    if (error instanceof Error && error.message === "Card not found")
      return Response.json({ error: "Card not found" }, { status: 404 });
    const errorId = logServerError("KANBAN CARD", error);
    return Response.json(
      { error: "Failed to load card details", errorId },
      { status: 500 }
    );
  }
};
