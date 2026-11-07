import "@tanstack/react-start/server-only";
import { requireSessionActor } from "~/lib/sessionActor";
import { SlackError, slackCall, slackEnvironment } from "./client";

export function slackFailure(error: unknown) {
  const code = error instanceof SlackError ? error.code : "unavailable";
  const messages: Record<string, string> = {
    not_configured:
      "Slack is not configured. Ask the deployment operator to set SLACK_BOT_TOKEN and SLACK_WORKSPACE_ID.",
    channel_not_found:
      "Slack cannot access this channel. Invite the Hawk Shop bot and choose the channel again.",
    not_in_channel: "Invite the Hawk Shop bot to the selected channel.",
    is_archived: "Choose an active Slack channel.",
    missing_scope:
      "Reinstall the Slack app with the permissions in the manifest.",
  };
  return Response.json(
    {
      error:
        messages[code] ??
        `Slack verification failed (${code}). Try again or contact the deployment operator.`,
      code,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
export async function requireSlackAdmin() {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;
  if (!actor.email)
    return Response.json(
      {
        error:
          "Sign in with an Onshape account whose email matches an active Slack workspace administrator.",
      },
      { status: 403 }
    );
  try {
    const { workspace } = slackEnvironment();
    const auth = await slackCall<{ team_id?: string; bot_id?: string }>(
      "auth.test"
    );
    if (auth.team_id !== workspace || !auth.bot_id)
      throw new SlackError("workspace_mismatch");
    const { user } = await slackCall<{
      user?: {
        id?: string;
        team_id?: string;
        deleted?: boolean;
        is_bot?: boolean;
        is_app_user?: boolean;
        is_admin?: boolean;
        is_owner?: boolean;
        is_primary_owner?: boolean;
      };
    }>("users.lookupByEmail", { email: actor.email });
    if (
      !user?.id ||
      user.team_id !== workspace ||
      user.deleted !== false ||
      user.is_bot !== false ||
      user.is_app_user === true ||
      !(
        user.is_admin === true ||
        user.is_owner === true ||
        user.is_primary_owner === true
      )
    ) {
      return Response.json(
        {
          error:
            "Only active Red Hawk Robotics Slack workspace administrators and owners can manage this integration.",
        },
        { status: 403 }
      );
    }
    return actor;
  } catch (error) {
    if (error instanceof SlackError && error.code === "users_not_found")
      return Response.json(
        {
          error:
            "Your Onshape email does not match an active Slack workspace administrator.",
        },
        { status: 403 }
      );
    return slackFailure(error);
  }
}
