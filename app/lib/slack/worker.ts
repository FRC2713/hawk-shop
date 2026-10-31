import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { slackPending } from "~/lib/db/schema";
import {
  SlackError,
  slackCall,
  slackEnvironment,
  slackCooldown,
} from "./client";
import { postSlackMessage } from "./messages";
import {
  cleanupSlackPending,
  getPendingSlackNotifications,
  type PendingSlackNotification,
} from "./queue";
import { getSlackSettings } from "./settings";

const state = globalThis as typeof globalThis & {
  __hawkSlackWorker?: {
    running: boolean;
    timer?: ReturnType<typeof setInterval>;
  };
};
const worker = (state.__hawkSlackWorker ??= { running: false });
const escape = (value: string, limit = 400) => {
  const text = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return text.length > limit ? text.slice(0, limit) + "…" : text;
};
function cardLink(id: string) {
  try {
    const base = new URL(process.env.APP_URL || "");
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw Error();
    return new URL(`/kanban?cardId=${encodeURIComponent(id)}`, base).href;
  } catch {
    throw new SlackError("app_url_invalid");
  }
}
async function mention(row: PendingSlackNotification, workspace: string) {
  if (!row.submitter_id || !row.submitter_email)
    return escape(row.submitter_name);
  try {
    const { user } = await slackCall<{
      user?: {
        id?: string;
        team_id?: string;
        deleted?: boolean;
        is_bot?: boolean;
        is_app_user?: boolean;
      };
    }>("users.lookupByEmail", { email: row.submitter_email });
    if (
      user?.id &&
      /^[UW][A-Z0-9]+$/.test(user.id) &&
      user.team_id === workspace &&
      user.deleted === false &&
      user.is_bot === false &&
      user.is_app_user !== true
    )
      return `<@${user.id}>`;
  } catch (error) {
    if (
      !(error instanceof SlackError) ||
      !["users_not_found", "missing_scope"].includes(error.code)
    )
      throw error;
  }
  return escape(row.submitter_name);
}
export async function formatSlackNotification(
  row: PendingSlackNotification,
  workspace: string
) {
  const submitter = await mention(row, workspace);
  return `${submitter}: ${escape(row.old_status)} → ${escape(row.new_status)}\n${escape(row.title, 1500)} · Quantity to make: ${row.quantity_to_make ?? "Not specified"}\n<${cardLink(row.card_id)}|Open card in Hawk Shop>`;
}
function current(row: PendingSlackNotification, now: number) {
  const settings = getSlackSettings();
  return (
    settings.enabled &&
    settings.channel_id === row.channel_id &&
    settings.generation === row.generation &&
    Date.parse(row.expires_at) > now &&
    db
      .select({ id: slackPending.id })
      .from(slackPending)
      .where(eq(slackPending.id, row.id))
      .get()
  );
}
// Public delivery operation for runtime startup and controlled transport/clock verification.
// A failed first transition blocks later transitions on that card, not other cards.
export async function runSlackDelivery({
  now = Date.now,
}: { now?: () => number } = {}) {
  if (worker.running) return;
  worker.running = true;
  try {
    cleanupSlackPending(now());
    const seen = new Set<string>();
    for (const row of getPendingSlackNotifications()) {
      if (
        Math.max(
          slackCooldown("post_spacing"),
          slackCooldown("method:chat.postMessage")
        ) > now()
      )
        break;
      if (seen.has(row.card_id)) continue;
      seen.add(row.card_id);
      if (Date.parse(row.next_attempt_at) > now() || !current(row, now()))
        continue;
      try {
        const { workspace } = slackEnvironment();
        const auth = await slackCall<{ team_id?: string; bot_id?: string }>(
          "auth.test"
        );
        if (auth.team_id !== workspace || !auth.bot_id)
          throw new SlackError("workspace_mismatch");
        const text = await formatSlackNotification(row, workspace);
        if (!current(row, now())) continue;
        await postSlackMessage(row.channel_id, text);
        db.delete(slackPending).where(eq(slackPending.id, row.id)).run();
      } catch (error) {
        const failure =
          error instanceof SlackError ? error : new SlackError("unavailable");
        const permanent = [
          "not_configured",
          "workspace_mismatch",
          "invalid_auth",
          "token_revoked",
          "account_inactive",
          "missing_scope",
          "channel_not_found",
          "not_in_channel",
          "is_archived",
          "restricted_action",
          "no_permission",
          "app_url_invalid",
        ].includes(failure.code);
        const delay = Math.max(
          failure.retryAfterSeconds ? failure.retryAfterSeconds * 1000 : 0,
          permanent
            ? 15 * 60 * 1000
            : Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(row.attempts, 12))
        );
        // UPDATE only: a canceled row can never be revived by an in-flight failure.
        db.update(slackPending)
          .set({
            attempts: row.attempts + 1,
            error_code: failure.code,
            next_attempt_at: new Date(
              Math.min(Date.parse(row.expires_at), now() + delay)
            ).toISOString(),
          })
          .where(eq(slackPending.id, row.id))
          .run();
      }
    }
  } finally {
    worker.running = false;
  }
}
export function stopSlackWorker() {
  if (worker.timer) clearInterval(worker.timer);
  worker.timer = undefined;
}
export function startSlackWorker() {
  if (worker.timer) return stopSlackWorker;
  const tick = () => {
    void runSlackDelivery().catch(() =>
      console.error("[SLACK] Delivery worker unavailable")
    );
  };
  worker.timer = setInterval(tick, 1000);
  worker.timer.unref();
  tick();
  return stopSlackWorker;
}
