import "@tanstack/react-start/server-only";
import { asc, eq, lte, or, ne } from "drizzle-orm";
import { db } from "~/lib/db/client";
import {
  DEFAULT_KANBAN_COLUMNS,
  kanbanConfig,
  slackPending,
  slackPostGate,
  users,
} from "~/lib/db/schema";
import type { KanbanCardRow } from "~/lib/db/types";
import type { SessionActor } from "~/lib/sessionActor";
import { getSlackSettings } from "./settings";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PendingSlackNotification = typeof slackPending.$inferSelect;
export const DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Called inside the card-update transaction. No network or asynchronous work.
export function captureSlackTransition(
  tx: Transaction,
  previous: KanbanCardRow,
  card: KanbanCardRow,
  actor: SessionActor
) {
  const settings = getSlackSettings(tx);
  if (
    !settings.enabled ||
    !settings.channel_id ||
    previous.created_by === actor.onshape_user_id
  )
    return;
  const submitter = previous.created_by
    ? tx
        .select()
        .from(users)
        .where(eq(users.onshape_user_id, previous.created_by))
        .get()
    : undefined;
  const columns =
    tx.select().from(kanbanConfig).where(eq(kanbanConfig.id, "default")).get()
      ?.columns ?? DEFAULT_KANBAN_COLUMNS;
  const status = (id: string) =>
    columns.find((column) => column.id === id)?.title ?? id;
  const now = Date.now();
  tx.insert(slackPending)
    .values({
      card_id: card.id,
      submitter_id: previous.created_by,
      submitter_name: previous.created_by
        ? submitter?.name || "Unknown submitter"
        : "Unknown submitter",
      submitter_email: submitter?.email ?? null,
      old_column_id: previous.column_id,
      new_column_id: card.column_id,
      old_status: status(previous.column_id),
      new_status: status(card.column_id),
      title: card.title,
      quantity_to_make: card.quantity_to_make,
      channel_id: settings.channel_id,
      generation: settings.generation,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + DELIVERY_WINDOW_MS).toISOString(),
      next_attempt_at: new Date(now).toISOString(),
    })
    .run();
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
}
