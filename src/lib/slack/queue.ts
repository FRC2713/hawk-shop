import "virtual:hawk-shop/server-only";
import { and, asc, eq, lte, ne, notExists, or } from "drizzle-orm";
import { db } from "~/server/db/client";
import {
  DEFAULT_KANBAN_COLUMNS,
  kanbanCards,
  kanbanConfig,
  slackPending,
  slackPostGate,
  slackThreads,
  users,
  type SlackReleasePayload,
} from "~/server/db/schema";
import type { KanbanCardRow } from "~/server/db/types";
import type { SessionActor } from "~/lib/sessionActor";
import { getSlackSettings } from "./settings";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PendingSlackNotification = typeof slackPending.$inferSelect;
export const DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

type Snapshot = Pick<
  KanbanCardRow,
  "id" | "title" | "quantity_to_make" | "column_id" | "created_by"
>;
function columnTitle(tx: Transaction, id: string) {
  const columns =
    tx.select().from(kanbanConfig).where(eq(kanbanConfig.id, "default")).get()
      ?.columns ?? DEFAULT_KANBAN_COLUMNS;
  return columns.find((column) => column.id === id)?.title ?? id;
}
// Queue one Slack event inside the caller's card transaction. No network or
// asynchronous work, so a restart cannot separate the card change from it.
function enqueue(
  tx: Transaction,
  card: Snapshot,
  actor: SessionActor | null,
  event: {
    kind: "release" | "status" | "removed" | "project";
    old_column_id: string;
    payload?: SlackReleasePayload;
  }
) {
  const settings = getSlackSettings(tx);
  if (!settings.enabled || !settings.channel_id) return;
  const submitter = card.created_by
    ? tx
        .select()
        .from(users)
        .where(eq(users.onshape_user_id, card.created_by))
        .get()
    : undefined;
  const now = Date.now();
  tx.insert(slackPending)
    .values({
      kind: event.kind,
      card_id: card.id,
      submitter_id: card.created_by,
      submitter_name: card.created_by
        ? submitter?.name || "Unknown submitter"
        : "Unknown submitter",
      submitter_email: submitter?.email ?? null,
      actor_name: actor ? actor.name || "Suite member" : null,
      old_column_id: event.old_column_id,
      new_column_id: card.column_id,
      old_status: columnTitle(tx, event.old_column_id),
      new_status: columnTitle(tx, card.column_id),
      title: card.title,
      quantity_to_make: card.quantity_to_make,
      payload: event.payload ?? null,
      channel_id: settings.channel_id,
      generation: settings.generation,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + DELIVERY_WINDOW_MS).toISOString(),
      next_attempt_at: new Date(now).toISOString(),
    })
    .run();
}
export function onshapeCardUrl(card: KanbanCardRow) {
  const { onshape_document_id: d, onshape_instance_id: i } = card;
  const { onshape_element_id: e, onshape_instance_type: type } = card;
  if (!d || !i || !e) return null;
  const wvm = type === "w" ? "w" : type === "v" ? "v" : "m";
  const base = process.env.ONSHAPE_BASE_URL || "https://cad.onshape.com";
  try {
    return new URL(`/documents/${d}/${wvm}/${i}/e/${e}`, base).href;
  } catch {
    return null;
  }
}
// A newly released part gets its own channel message; later updates thread under it.
export function captureSlackRelease(
  tx: Transaction,
  card: KanbanCardRow,
  actor: SessionActor,
  processNames: string[],
  projectName: string
) {
  enqueue(tx, card, actor, {
    kind: "release",
    old_column_id: card.column_id,
    payload: {
      machine: card.machine,
      due_date: card.due_date,
      processes: processNames,
      issues: (card.release_issues ?? []).map((issue) => ({
        severity: issue.severity,
        message: issue.message,
      })),
      onshape_url: onshapeCardUrl(card),
      project: projectName,
    },
  });
}
// A project change edits the part's message in place; the worker rebuilds it
// from the card. Nothing is posted when the part has no message yet.
export function captureSlackProjectChange(
  tx: Transaction,
  card: KanbanCardRow,
  actor: SessionActor
) {
  enqueue(tx, card, actor, { kind: "project", old_column_id: card.column_id });
}
// Every move between columns is posted, whoever made it.
export function captureSlackTransition(
  tx: Transaction,
  previous: KanbanCardRow,
  card: KanbanCardRow,
  actor: SessionActor
) {
  enqueue(tx, card, actor, {
    kind: "status",
    old_column_id: previous.column_id,
  });
}
// Deletion replies in the part's thread. The worker drops it when the part
// never had a message.
export function captureSlackRemoval(
  tx: Transaction,
  card: KanbanCardRow,
  actor: SessionActor | null
) {
  enqueue(tx, card, actor, { kind: "removed", old_column_id: card.column_id });
}
export function getPendingSlackNotifications() {
  return db.select().from(slackPending).orderBy(asc(slackPending.id)).all();
}
export function cleanupSlackPending(now = Date.now()) {
  const settings = getSlackSettings();
  db.delete(slackPostGate)
    .where(lte(slackPostGate.next_post_at, new Date(now).toISOString()))
    .run();
  db.delete(slackPending)
    .where(
      or(
        lte(slackPending.expires_at, new Date(now).toISOString()),
        ne(slackPending.generation, settings.generation)
      )
    )
    .run();
  if (!settings.enabled) db.delete(slackPending).run();
  // Forget thread anchors for deleted cards once nothing is left to reply.
  db.delete(slackThreads)
    .where(
      and(
        notExists(
          db
            .select({ id: kanbanCards.id })
            .from(kanbanCards)
            .where(eq(kanbanCards.id, slackThreads.card_id))
        ),
        notExists(
          db
            .select({ id: slackPending.id })
            .from(slackPending)
            .where(eq(slackPending.card_id, slackThreads.card_id))
        )
      )
    )
    .run();
}
