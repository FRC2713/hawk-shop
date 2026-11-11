import "virtual:hawk-shop/server-only";
import { requireSessionActor } from "~/lib/sessionActor";
import {
  SlackError,
  isActiveHuman,
  slackCall,
  slackEnvironment,
  slackUserFromSubject,
  type SlackMember,
} from "./client";

export function slackFailure(error: unknown) {
  const code = error instanceof SlackError ? error.code : "unavailable";
  const messages: Record<string, string> = {
    not_configured:
      "Slack is not configured. Ask the deployment operator to set SLACK_BOT_TOKEN.",
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
// Admin authority comes from the Slack member ID in the verified Suite identity,
// rechecked with Slack on every call. Email plays no part.
export async function requireSlackAdmin() {
  const actor = await requireSessionActor();
  if (actor instanceof Response) return actor;
  const denied = () =>
    Response.json(
      {
        error:
          "Only active Red Hawk Robotics Slack workspace administrators and owners can manage this integration.",
      },
      { status: 403 }
    );
  try {
    const { workspace } = slackEnvironment();
    const memberId = slackUserFromSubject(actor.onshape_user_id, workspace);
    if (!memberId) return denied();
    const auth = await slackCall<{ team_id?: string; bot_id?: string }>(
      "auth.test"
    );
    if (auth.team_id !== workspace || !auth.bot_id)
      throw new SlackError("workspace_mismatch");
    const { user } = await slackCall<{ user?: SlackMember }>("users.info", {
      user: memberId,
    });
    if (
      !isActiveHuman(user, workspace) ||
      user.id !== memberId ||
      !(
        user.is_admin === true ||
        user.is_owner === true ||
        user.is_primary_owner === true
      )
    )
      return denied();
    return actor;
  } catch (error) {
    if (error instanceof SlackError && error.code === "user_not_found")
      return denied();
    return slackFailure(error);
  }
}
