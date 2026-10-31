import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { slackPostGate } from "~/lib/db/schema";

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
export function slackEnvironment() {
  const token = process.env.SLACK_BOT_TOKEN;
  const workspace = process.env.SLACK_WORKSPACE_ID;
  if (!token || !workspace) throw new SlackError("not_configured");
  return { token, workspace };
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
  "restricted_action",
  "no_permission",
  "ratelimited",
]);
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
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
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
