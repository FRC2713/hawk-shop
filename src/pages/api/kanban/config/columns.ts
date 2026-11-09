import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { DEFAULT_KANBAN_COLUMNS } from "~/server/kanbanApi/columnTypes";
import { getKanbanColumns } from "~/server/kanbanApi/config";

export const GET: APIRoute = async () => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const columns = await getKanbanColumns();
    return Response.json(columns);
  } catch (error) {
    console.error("[KANBAN COLUMNS] Error loading columns:", error);
    return Response.json(DEFAULT_KANBAN_COLUMNS, { status: 500 });
  }
};
