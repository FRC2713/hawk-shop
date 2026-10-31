import "@tanstack/react-start/server-only";
import { eq, inArray } from "drizzle-orm";
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
  return `${await mention(row, workspace)}: ${escape(row.old_status)} → ${escape(row.new_status)}\n${partEntry(row)}`;
}
function partEntry(row: PendingSlackNotification) {
  return `${escape(row.title, 1500)} · Quantity to make: ${row.quantity_to_make ?? "Not specified"}\n<${cardLink(row.card_id)}|Open card in Hawk Shop>`;
}
const GROUP_WINDOW_MS = 10_000;
// Claim only the first outstanding transition on each card. This prevents cycles
// such as A: Review→Done and B: Done→Review from blocking each other's groups.
// Membership freezes before any asynchronous work, so new arrivals cannot join
// a partially delivered group or extend its original collection window.
function claimGroups(now: number) {
  return db.transaction((tx) => {
    const pending = getPendingSlackNotifications();
    const seen = new Set<string>();
    const frontier = pending.filter((row) => {
      if (seen.has(row.card_id)) return false;
      seen.add(row.card_id);
      return true;
    });
    for (const anchor of frontier) {
      if (
        anchor.delivery_group !== null ||
        Date.parse(anchor.created_at) + GROUP_WINDOW_MS > now
      )
        continue;
      const members = frontier.filter(
        (row) =>
          row.delivery_group === null &&
          row.submitter_id === anchor.submitter_id &&
          row.old_column_id === anchor.old_column_id &&
          row.new_column_id === anchor.new_column_id &&
          row.old_status === anchor.old_status &&
          row.new_status === anchor.new_status &&
          row.channel_id === anchor.channel_id &&
          row.generation === anchor.generation &&
          Date.parse(row.created_at) >= Date.parse(anchor.created_at) &&
          Date.parse(row.created_at) <=
            Date.parse(anchor.created_at) + GROUP_WINDOW_MS
      );
      tx.update(slackPending)
        .set({ delivery_group: anchor.id })
        .where(
          inArray(
            slackPending.id,
            members.map((row) => row.id)
          )
        )
        .run();
      for (const row of members) row.delivery_group = anchor.id;
    }
    const groups = new Map<number, PendingSlackNotification[]>();
    for (const row of frontier) {
      if (row.delivery_group === null) continue;
      const group = groups.get(row.delivery_group) ?? [];
      group.push(row);
      groups.set(row.delivery_group, group);
    }
    return [...groups.values()];
  });
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
    for (const group of claimGroups(now())) {
      const row = group[0];
      if (
        Math.max(
          slackCooldown("post_spacing"),
          slackCooldown("method:chat.postMessage")
        ) > now()
      )
        break;
      if (Date.parse(row.next_attempt_at) > now() || !current(row, now()))
        continue;
      let chunk = group;
      try {
        const { workspace } = slackEnvironment();
        const auth = await slackCall<{ team_id?: string; bot_id?: string }>(
          "auth.test"
        );
        if (auth.team_id !== workspace || !auth.bot_id)
          throw new SlackError("workspace_mismatch");
        const header = `${await mention(row, workspace)}: ${escape(row.old_status)} → ${escape(row.new_status)}`;
        let text = header;
        chunk = [];
        for (const member of group) {
          const entry = "\n" + partEntry(member);
          if (text.length + entry.length > 3900 && chunk.length) break;
          text += entry;
          chunk.push(member);
        }
        if (!chunk.every((member) => current(member, now()))) continue;
        await postSlackMessage(row.channel_id, text);
        db.delete(slackPending)
          .where(
            inArray(
              slackPending.id,
              chunk.map((member) => member.id)
            )
          )
          .run();
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
        for (const member of chunk.length ? chunk : group)
          db.update(slackPending)
            .set({
              attempts: member.attempts + 1,
              error_code: failure.code,
              next_attempt_at: new Date(
                Math.min(Date.parse(member.expires_at), now() + delay)
              ).toISOString(),
            })
            .where(eq(slackPending.id, member.id))
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
