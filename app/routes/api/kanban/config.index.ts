import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import {
  DEFAULT_CONFIG,
  getKanbanConfig,
  saveKanbanConfig,
} from "~/lib/kanbanApi/config";
import type { KanbanConfig } from "~/lib/kanbanApi/columnTypes";

export const Route = createFileRoute("/api/kanban/config/")({
  server: {
    handlers: {
      GET: async () => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        try {
          const config = await getKanbanConfig();
          return Response.json(config);
        } catch (error) {
          console.error("[KANBAN CONFIG] Error loading config:", error);
          return Response.json(DEFAULT_CONFIG, { status: 500 });
        }
      },

      PUT: async ({ request }) => {
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
          console.error("[KANBAN CONFIG] Error saving config:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to save config";
          return Response.json({ error: errorMessage }, { status: 500 });
        }
      },
    },
  },
});
