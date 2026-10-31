import { createFileRoute } from "@tanstack/react-router";
import { requireSlackAdmin } from "~/lib/slack/admin";
import { getSlackStatus } from "~/lib/slack/status";
export const Route = createFileRoute("/api/slack/status")({
  server: {
    handlers: {
      GET: async () => {
        const actor = await requireSlackAdmin();
        if (actor instanceof Response) return actor;
        return Response.json(await getSlackStatus(), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
