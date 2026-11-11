import "virtual:hawk-shop/server-only";
import { and, eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import {
  kanbanCardProcesses,
  kanbanCards,
  processes as processes_,
  slackPending,
  slackThreads,
  type SlackReleasePayload,
} from "~/server/db/schema";
import { readStoredFile } from "~/server/storage/files";
import { storedCardThumbnail } from "~/server/thumbnails";
import { uploadSlackImage } from "./files";
import {
  SlackError,
  isActiveHuman,
  slackCall,
  slackEnvironment,
  slackCooldown,
  slackUserFromSubject,
  type SlackMember,
} from "./client";
import { postSlackMessage } from "./messages";
import { slackAppBaseUrl } from "./appUrl";
import {
  cleanupSlackPending,
  getPendingSlackNotifications,
  onshapeCardUrl,
  type PendingSlackNotification,
} from "./queue";
import { getSlackSettings } from "./settings";
import { deliverProblemReports } from "~/server/reports";

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
  return new URL(`/kanban?cardId=${encodeURIComponent(id)}`, slackAppBaseUrl())
    .href;
}
// Suite submitters carry their Slack member ID. Cards released before Suite
// sign-in only have an Onshape ID, so they fall back to the saved email.
async function mention(row: PendingSlackNotification, workspace: string) {
  const memberId = slackUserFromSubject(row.submitter_id, workspace);
  if (!memberId && !row.submitter_email) return escape(row.submitter_name);
  try {
    const { user } = memberId
      ? await slackCall<{ user?: SlackMember }>("users.info", {
          user: memberId,
        })
      : await slackCall<{ user?: SlackMember }>("users.lookupByEmail", {
          email: row.submitter_email,
        });
    if (isActiveHuman(user, workspace) && (!memberId || user.id === memberId))
      return `<@${user.id}>`;
  } catch (error) {
    if (
      !(error instanceof SlackError) ||
      !["users_not_found", "user_not_found", "missing_scope"].includes(
        error.code
      )
    )
      throw error;
  }
  return escape(row.submitter_name);
}
type Thread = { card_id: string; channel_id: string; ts: string };
function threadFor(row: PendingSlackNotification): Thread | undefined {
  return db
    .select()
    .from(slackThreads)
    .where(
      and(
        eq(slackThreads.card_id, row.card_id),
        eq(slackThreads.channel_id, row.channel_id)
      )
    )
    .get();
}
// Only the earliest pending event on each card is eligible, so a part's
// message always goes out before its replies and replies stay in order.
function frontier() {
  const seen = new Set<string>();
  return getPendingSlackNotifications().filter((row) => {
    if (seen.has(row.card_id)) return false;
    seen.add(row.card_id);
    return true;
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
function done(row: PendingSlackNotification) {
  db.delete(slackPending).where(eq(slackPending.id, row.id)).run();
}
// What the part's message shows. A release uses the snapshot taken with the
// card. A part released before threads existed gets its message the first
// time its status changes, built from the card as it is now.
function partDetails(row: PendingSlackNotification): {
  payload: SlackReleasePayload;
  quantity_to_make: number | null;
  status: string;
} {
  if (row.kind === "release" && row.payload)
    return {
      payload: row.payload,
      quantity_to_make: row.quantity_to_make,
      status: row.new_status,
    };
  const card = db
    .select()
    .from(kanbanCards)
    .where(eq(kanbanCards.id, row.card_id))
    .get();
  const processes = card
    ? db
        .select({ name: processes_.name })
        .from(kanbanCardProcesses)
        .innerJoin(
          processes_,
          eq(kanbanCardProcesses.process_id, processes_.id)
        )
        .where(eq(kanbanCardProcesses.card_id, card.id))
        .all()
        .map((process) => process.name)
    : [];
  return {
    payload: {
      quantity_per_robot: card?.quantity_per_robot ?? null,
      machine: card?.machine ?? null,
      due_date: card?.due_date ?? null,
      processes,
      issues: (card?.release_issues ?? []).map((issue) => ({
        severity: issue.severity,
        message: issue.message,
      })),
      onshape_url: card ? onshapeCardUrl(card) : null,
    },
    quantity_to_make: row.quantity_to_make,
    // The message describes the part before this pending move.
    status: row.old_status,
  };
}
function plain(value: string, limit: number) {
  return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
}
function partBlocks(
  row: PendingSlackNotification,
  who: string,
  fileId: string | null
) {
  const { payload, quantity_to_make, status } = partDetails(row);
  const show = (value: string | number | null | undefined) =>
    value === null || value === undefined || value === ""
      ? "Not specified"
      : escape(String(value), 200);
  const fields = [
    ["Quantity to make", show(quantity_to_make)],
    ["Quantity per robot", show(payload.quantity_per_robot)],
    ["Machine", show(payload.machine)],
    [
      "Processes",
      payload.processes.length
        ? escape(payload.processes.join(", "), 300)
        : "Not specified",
    ],
    ["Due date", show(payload.due_date?.slice(0, 10))],
    ["Status", escape(status, 200)],
  ].map(([label, value]) => ({ type: "mrkdwn", text: `*${label}*\n${value}` }));
  const links = [`<${cardLink(row.card_id)}|Open in Hawk Shop>`];
  if (payload.onshape_url)
    links.push(`<${payload.onshape_url}|Open in Onshape>`);
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: plain(row.title, 150), emoji: false },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `Released by ${who}` },
      fields,
      ...(fileId
        ? {
            accessory: {
              type: "image",
              slack_file: { id: fileId },
              alt_text: plain(`Thumbnail of ${row.title}`, 2000),
            },
          }
        : {}),
    },
  ];
  if (payload.issues.length)
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: escape(
            payload.issues
              .slice(0, 10)
              .map(
                (issue) =>
                  `${issue.severity === "error" ? "Error" : "Warning"}: ${issue.message}`
              )
              .join("\n"),
            2900
          ),
        },
      ],
    });
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: links.join("  ·  ") }],
  });
  return blocks;
}
// Upload the stored thumbnail, if there is one. Never fetches from Onshape:
// a part whose image is not stored yet goes out without one. Any upload
// failure, including a missing files:write scope, also means no image.
async function prepareThumbnail(row: PendingSlackNotification) {
  const card = db
    .select()
    .from(kanbanCards)
    .where(eq(kanbanCards.id, row.card_id))
    .get();
  let fileId = "none";
  try {
    const path = card ? storedCardThumbnail(card) : null;
    const bytes = path ? await readStoredFile(path) : null;
    if (bytes?.length)
      fileId = await uploadSlackImage(
        bytes,
        `${row.card_id}.png`,
        plain(row.title, 200)
      );
  } catch (error) {
    console.warn(
      "[SLACK] Thumbnail upload skipped:",
      error instanceof SlackError ? error.code : "unavailable"
    );
  }
  db.update(slackPending)
    .set({ file_id: fileId })
    .where(eq(slackPending.id, row.id))
    .run();
  return fileId;
}
function postingBlocked(now: number) {
  return (
    Math.max(
      slackCooldown("post_spacing"),
      slackCooldown("method:chat.postMessage")
    ) > now
  );
}
// Public delivery operation for runtime startup and controlled transport/clock verification.
// A failed event blocks later events on that card, not other cards.
export async function runSlackDelivery({
  now = Date.now,
}: { now?: () => number } = {}) {
  if (worker.running) return;
  worker.running = true;
  try {
    await deliverProblemReports(now);
    cleanupSlackPending(now());
    for (const row of frontier()) {
      if (postingBlocked(now())) break;
      if (Date.parse(row.next_attempt_at) > now() || !current(row, now()))
        continue;
      try {
        const { workspace } = slackEnvironment();
        const auth = await slackCall<{ team_id?: string; bot_id?: string }>(
          "auth.test"
        );
        if (auth.team_id !== workspace || !auth.bot_id)
          throw new SlackError("workspace_mismatch");
        const thread = threadFor(row);
        if (row.kind === "removed") {
          if (thread) {
            if (!current(row, now())) continue;
            await postSlackMessage(
              row.channel_id,
              `${await mention(row, workspace)}: ${escape(row.title, 200)} was removed from the board${row.actor_name ? ` by ${escape(row.actor_name, 100)}` : ""}.`,
              { thread_ts: thread.ts }
            );
          }
          done(row);
          db.delete(slackThreads)
            .where(eq(slackThreads.card_id, row.card_id))
            .run();
          continue;
        }
        if (!thread) {
          // A release waits one pass after uploading, so Slack has finished
          // processing the image before a message refers to it.
          if (row.kind === "release" && row.file_id === null) {
            if ((await prepareThumbnail(row)) !== "none") continue;
            row.file_id = "none";
          }
          const fileId =
            row.kind === "release" && row.file_id !== "none"
              ? row.file_id
              : null;
          const who = await mention(row, workspace);
          if (!current(row, now())) continue;
          const { ts } = await postSlackMessage(
            row.channel_id,
            `New part released: ${escape(row.title, 200)}`,
            { blocks: partBlocks(row, who, fileId) }
          );
          db.insert(slackThreads)
            .values({
              card_id: row.card_id,
              channel_id: row.channel_id,
              ts,
            })
            .onConflictDoNothing()
            .run();
          // A status event stays queued; its reply goes out on a later pass.
          if (row.kind === "release") done(row);
          continue;
        }
        // A thread already exists: a repeated release has nothing to add.
        if (row.kind === "release") {
          done(row);
          continue;
        }
        const header = `${await mention(row, workspace)}: ${escape(row.old_status)} → ${escape(row.new_status)}`;
        const by = row.actor_name
          ? ` · moved by ${escape(row.actor_name, 100)}`
          : "";
        if (!current(row, now())) continue;
        await postSlackMessage(row.channel_id, header + by, {
          thread_ts: thread.ts,
        });
        done(row);
      } catch (error) {
        const failure =
          error instanceof SlackError ? error : new SlackError("unavailable");
        // Slack could not show the uploaded image: send without it.
        if (
          failure.code === "invalid_blocks" &&
          row.file_id &&
          row.file_id !== "none"
        ) {
          db.update(slackPending)
            .set({ file_id: "none" })
            .where(eq(slackPending.id, row.id))
            .run();
        }
        // The part's message was deleted in Slack: start a new one.
        if (["thread_not_found", "message_not_found"].includes(failure.code))
          db.delete(slackThreads)
            .where(
              and(
                eq(slackThreads.card_id, row.card_id),
                eq(slackThreads.channel_id, row.channel_id)
              )
            )
            .run();
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
