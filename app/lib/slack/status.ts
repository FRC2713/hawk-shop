import "@tanstack/react-start/server-only";
import { SlackError } from "./client";
import { slackAppBaseUrl } from "./appUrl";
import { validateSlackChannel } from "./channels";
import { cleanupSlackPending, getPendingSlackNotifications } from "./queue";
import { getSlackSettings } from "./settings";
import type { SlackDeliveryIssue, SlackStatus } from "./types";

function issue(code: string): SlackDeliveryIssue {
  const actions: Record<string, string> = {
    not_configured:
      "Ask the deployment operator to set SLACK_BOT_TOKEN and SLACK_WORKSPACE_ID.",
    workspace_mismatch:
      "Ask the deployment operator to check the workspace ID and bot installation.",
    invalid_auth: "Ask the deployment operator to replace the Slack bot token.",
    token_revoked:
      "Ask the deployment operator to reinstall the Slack app and replace its bot token.",
    account_inactive:
      "Ask the deployment operator to check the Slack app installation.",
    missing_scope:
      "Reinstall the Slack app with the permissions in the manifest.",
    channel_not_found:
      "Invite the Hawk Shop bot to the destination and choose an accessible channel.",
    not_in_channel: "Invite the Hawk Shop bot to the selected channel.",
    is_archived: "Choose an active Slack channel.",
    restricted_action:
      "Ask a workspace owner to check Slack app posting restrictions.",
    no_permission:
      "Ask a workspace owner to check the bot's channel permissions.",
    app_url_invalid:
      "Ask the deployment operator to set APP_URL to the Hawk Shop HTTP or HTTPS address.",
    ratelimited:
      "Slack asked Hawk Shop to wait. Delivery resumes automatically after the retry time.",
    unavailable:
      "Check Slack connectivity from the server. Pending work retries automatically until expiry.",
  };
  return {
    code: Object.hasOwn(actions, code) ? code : "unavailable",
    action: actions[code] ?? actions.unavailable,
  };
}

// Call only after fresh server-side Slack administrator authorization.
export async function getSlackStatus(): Promise<SlackStatus> {
  cleanupSlackPending();
  let settings = getSlackSettings();
  let currentIssue: SlackDeliveryIssue | null = null;
  if (settings.channel_id) {
    try {
      await validateSlackChannel(settings.channel_id);
    } catch (error) {
      currentIssue = issue(
        error instanceof SlackError ? error.code : "unavailable"
      );
    }
  } else if (settings.enabled) currentIssue = issue("channel_not_found");
  const latestSettings = getSlackSettings();
  if (latestSettings.generation !== settings.generation) {
    // The awaited channel result belongs to a canceled destination/configuration.
    currentIssue = null;
    settings = latestSettings;
  }
  if (!currentIssue && settings.enabled) {
    try {
      slackAppBaseUrl();
    } catch {
      currentIssue = issue("app_url_invalid");
    }
  }
  // Read after the channel probe so concurrent delivery/cancellation cannot leave stale rows.
  cleanupSlackPending();
  const pending = getPendingSlackNotifications().map((row) => ({
    id: row.id,
    card_id: row.card_id,
    title: row.title,
    submitter_name: row.submitter_name,
    old_status: row.old_status,
    new_status: row.new_status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    next_attempt_at: row.next_attempt_at,
    attempts: row.attempts,
    issue: row.error_code ? issue(row.error_code) : null,
  }));
  return {
    settings,
    health: {
      state: !settings.enabled
        ? "disabled"
        : currentIssue || pending.some((row) => row.issue)
          ? "problem"
          : pending.length
            ? "pending"
            : "ready",
      issue: currentIssue,
    },
    pending_count: pending.length,
    pending,
  };
}
