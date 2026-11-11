import "virtual:hawk-shop/server-only";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import { slackPostGate } from "~/server/db/schema";

export function slackCooldown(id: string) {
  return (
    Date.parse(
      db.select().from(slackPostGate).where(eq(slackPostGate.id, id)).get()
        ?.next_post_at ?? ""
    ) || 0
  );
}
export function deferSlackCall(id: string, until: number) {
  const next_post_at = new Date(
    Math.max(slackCooldown(id), until)
  ).toISOString();
  db.insert(slackPostGate)
    .values({ id, next_post_at })
    .onConflictDoUpdate({ target: slackPostGate.id, set: { next_post_at } })
    .run();
}

// Only stable codes leave this module. Never expose upstream bodies or exception messages.
export class SlackError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(`Slack: ${code}`);
  }
}
// The bot's workspace is normally the Suite workspace, so its ID is the default.
export function slackEnvironment() {
  const token = process.env.SLACK_BOT_TOKEN;
  const workspace =
    process.env.SLACK_WORKSPACE_ID || process.env.HAWK_SUITE_TEAM_ID;
  if (!token || !workspace) throw new SlackError("not_configured");
  return { token, workspace };
}

// Suite subjects are `slack:<team>:<user>`. Only a member of the bot's
// workspace yields an ID; legacy Onshape IDs and other workspaces do not.
export function slackUserFromSubject(
  subject: string | null | undefined,
  workspace: string
) {
  const match = /^slack:(T[A-Z0-9]+):([UW][A-Z0-9]+)$/.exec(subject ?? "");
  return match && match[1] === workspace ? match[2] : undefined;
}

export type SlackMember = {
  id?: string;
  team_id?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
};
export function isActiveHuman(
  user: SlackMember | undefined,
  workspace: string
): user is SlackMember & { id: string } {
  return Boolean(
    user?.id &&
    /^[UW][A-Z0-9]+$/.test(user.id) &&
    user.team_id === workspace &&
    user.deleted === false &&
    user.is_bot === false &&
    user.is_app_user !== true
  );
}
const safeCodes = new Set([
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "missing_scope",
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "users_not_found",
  "user_not_found",
  "restricted_action",
  "no_permission",
  "ratelimited",
]);
// Slack reads JSON bodies only on some write methods. Read methods such as
// users.info ignore them and report the argument missing, so every call is
// sent as a form, which all methods accept. Arguments are flat values.
export function slackForm(body: Record<string, unknown>) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body))
    if (value !== undefined && value !== null) form.set(key, String(value));
  return form;
}
export async function slackCall<T>(
  method: string,
  body: Record<string, unknown> = {},
  timeoutMs = 10000
): Promise<T> {
  const { token } = slackEnvironment();
  const remaining = slackCooldown(`method:${method}`) - Date.now();
  if (remaining > 0)
    throw new SlackError("ratelimited", Math.ceil(remaining / 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: slackForm(body),
    });
    if (response.status === 429) {
      const delay = Number(response.headers.get("Retry-After"));
      const retryAfter = Number.isFinite(delay) && delay > 0 ? delay : 60;
      // Store the complete Retry-After, including values beyond this event's life.
      deferSlackCall(`method:${method}`, Date.now() + retryAfter * 1000);
      throw new SlackError("ratelimited", retryAfter);
    }
    if (!response.ok) throw new SlackError("unavailable");
    const data = await response.json();
    if (data?.ok !== true)
      throw new SlackError(
        safeCodes.has(data?.error) ? data.error : "unavailable"
      );
    return data as T;
  } catch (error) {
    if (error instanceof SlackError) throw error;
    throw new SlackError("unavailable");
  } finally {
    clearTimeout(timer);
  }
}
