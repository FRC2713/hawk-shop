import { createFileRoute } from "@tanstack/react-router";
import { requireSlackAdmin, slackFailure } from "~/lib/slack/admin";
import { listSlackChannels } from "~/lib/slack/channels";
export const Route = createFileRoute("/api/slack/channels")({
  server: {
    handlers: {
      GET: async () => {
        const actor = await requireSlackAdmin();
        if (actor instanceof Response) return actor;
        try {
          return Response.json(
            { channels: await listSlackChannels() },
            { headers: { "Cache-Control": "no-store" } }
          );
        } catch (error) {
          return slackFailure(error);
        }
      },
    },
  },
});
