import { logServerError } from "~/server/errors";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import {
  DEFAULT_CONFIG,
  getKanbanConfig,
  saveKanbanConfig,
} from "~/server/kanbanApi/config";
import type { KanbanConfig } from "~/server/kanbanApi/columnTypes";

export const GET: APIRoute = async () => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const config = await getKanbanConfig();
    return Response.json(config);
  } catch (error) {
    const errorId = logServerError("KANBAN CONFIG", error);
    return Response.json({ ...DEFAULT_CONFIG, errorId }, { status: 500 });
  }
};
export const PUT: APIRoute = async ({ request }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  try {
    const config = (await request.json()) as KanbanConfig;

    // Validate the config
    if (!config.columns || !Array.isArray(config.columns)) {
      return Response.json(
        { error: "Invalid config structure" },
        { status: 400 }
      );
    }

    await saveKanbanConfig(config);

    return Response.json({ success: true, config });
  } catch (error) {
    const errorId = logServerError("KANBAN CONFIG", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to save config";
    return Response.json({ error: errorMessage, errorId }, { status: 500 });
  }
};
