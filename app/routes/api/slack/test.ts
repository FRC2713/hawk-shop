import { createFileRoute } from "@tanstack/react-router";
import { requireSlackAdmin, slackFailure } from "~/lib/slack/admin";
import { validateSlackChannel } from "~/lib/slack/channels";
import { postSlackMessage } from "~/lib/slack/messages";
import { rejectSlackCrossOrigin } from "~/lib/slack/request";
import { getSlackSettings } from "~/lib/slack/settings";
export const Route = createFileRoute("/api/slack/test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rejected = rejectSlackCrossOrigin(request);
        if (rejected) return rejected;
        const actor = await requireSlackAdmin();
        if (actor instanceof Response) return actor;
        const settings = getSlackSettings();
        if (!settings.channel_id)
          return Response.json(
            { error: "Save a destination channel before sending a test." },
            { status: 400 }
          );
        try {
          const channel = await validateSlackChannel(settings.channel_id);
          await postSlackMessage(
            channel.id,
            "Hawk Shop test message. Slack notifications can reach this channel. Submitters must belong to this channel for mentions to notify them."
          );
          return Response.json(
            { success: true },
            { headers: { "Cache-Control": "no-store" } }
          );
        } catch (error) {
          return slackFailure(error);
        }
      },
    },
  },
});
