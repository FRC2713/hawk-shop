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
  // Say which check failed so an administrator can fix it. Member and
  // workspace IDs are the caller's own and carry no secret.
  const denied = (reason: string, detail: string) => {
    console.warn(`[SLACK] Admin access denied: ${reason}`);
    return Response.json(
      {
        error: `Only active Red Hawk Robotics Slack workspace administrators and owners can manage this integration. ${detail}`,
        code: reason,
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  };
  let memberId: string | undefined;
  let workspace = "";
  try {
    workspace = slackEnvironment().workspace;
    memberId = slackUserFromSubject(actor.onshape_user_id, workspace);
    if (!memberId)
      return denied(
        "other_workspace",
        `Your Hawk Suite sign-in is not for the bot's Slack workspace (${workspace}).`
      );
    const auth = await slackCall<{ team_id?: string; bot_id?: string }>(
      "auth.test"
    );
    if (auth.team_id !== workspace || !auth.bot_id)
      throw new SlackError("workspace_mismatch");
    const { user } = await slackCall<{ user?: SlackMember }>("users.info", {
      user: memberId,
    });
    const who = `Slack member ${memberId} in workspace ${workspace}`;
    if (!user || user.id !== memberId)
      return denied("member_mismatch", `Slack did not return ${who}.`);
    if (user.team_id !== workspace)
      return denied(
        "member_other_workspace",
        `Slack reports ${memberId} belongs to workspace ${user.team_id ?? "unknown"}, not ${workspace}.`
      );
    if (!isActiveHuman(user, workspace))
      return denied(
        "inactive_member",
        `Slack reports ${who} is deactivated, a bot, or an app user.`
      );
    if (!(
      user.is_admin === true ||
      user.is_owner === true ||
      user.is_primary_owner === true
    ))
      return denied(
        "not_admin",
        `Slack reports ${who} is not a workspace administrator or owner.`
      );
    return actor;
  } catch (error) {
    if (error instanceof SlackError && error.code === "user_not_found")
      return denied(
        "unknown_member",
        `Slack cannot find member ${memberId} in workspace ${workspace}.`
      );
    return slackFailure(error);
  }
}
