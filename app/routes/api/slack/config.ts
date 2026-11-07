import { createFileRoute } from "@tanstack/react-router";
import { requireSlackAdmin, slackFailure } from "~/lib/slack/admin";
import { validateSlackChannel } from "~/lib/slack/channels";
import { rejectSlackCrossOrigin } from "~/lib/slack/request";
import { getSlackSettings, saveSlackSettings } from "~/lib/slack/settings";
export const Route = createFileRoute("/api/slack/config")({
  server: {
    handlers: {
      GET: async () => {
        const actor = await requireSlackAdmin();
        return actor instanceof Response
          ? actor
          : Response.json(getSlackSettings(), {
              headers: { "Cache-Control": "no-store" },
            });
      },
      PUT: async ({ request }) => {
        const rejected = rejectSlackCrossOrigin(request);
        if (rejected) return rejected;
        const actor = await requireSlackAdmin();
        if (actor instanceof Response) return actor;
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }
        if (
          !body ||
          typeof body.enabled !== "boolean" ||
          !(body.channel_id === null || typeof body.channel_id === "string") ||
          (body.enabled && !body.channel_id)
        )
          return Response.json(
            { error: "Choose a channel before enabling notifications." },
            { status: 400 }
          );
        try {
          const channel = body.channel_id
            ? await validateSlackChannel(body.channel_id)
            : null;
          return Response.json(
            saveSlackSettings(
              channel?.id ?? null,
              channel?.name ?? null,
              body.enabled
            ),
            { headers: { "Cache-Control": "no-store" } }
          );
        } catch (error) {
          return slackFailure(error);
        }
      },
    },
  },
});
