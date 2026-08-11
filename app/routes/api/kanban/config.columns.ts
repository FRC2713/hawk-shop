import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { DEFAULT_KANBAN_COLUMNS } from "~/lib/kanbanApi/columnTypes";
import { getKanbanColumns } from "~/lib/kanbanApi/config";

export const Route = createFileRoute("/api/kanban/config/columns")({
  server: {
    handlers: {
      GET: async () => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const columns = await getKanbanColumns();
          return Response.json(columns);
        } catch (error) {
          console.error("[KANBAN COLUMNS] Error loading columns:", error);
          return Response.json(DEFAULT_KANBAN_COLUMNS, { status: 500 });
        }
      },
    },
  },
});
