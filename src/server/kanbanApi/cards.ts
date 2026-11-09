import "virtual:hawk-shop/server-only";

import { captureSlackTransition } from "~/lib/slack/queue";
import type { SessionActor } from "~/lib/sessionActor";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "~/server/db/client";
import {
  DEFAULT_KANBAN_COLUMNS,
  kanbanCardProcesses,
  kanbanCards,
  processes as processesTable,
} from "~/server/db/schema";
import { getKanbanColumns } from "~/server/kanbanApi/config";
import { publishKanbanEvent } from "~/server/events/bus";
import type {
  KanbanCardRow,
  KanbanCardWithProcesses,
  ProcessRow,
} from "~/server/db/types";

/**
 * Result type for getCards to distinguish errors from empty results
 */
export interface GetCardsResult {
  cards: KanbanCardWithProcesses[];
  error?: string;
}

/**
 * Load the process rows attached to each of `cardIds`, keyed by card id.
 * One query for the whole board rather than one per card.
 */
async function processesByCardId(
  cardIds: string[]
): Promise<Map<string, ProcessRow[]>> {
  const byCard = new Map<string, ProcessRow[]>();
  if (cardIds.length === 0) return byCard;

  const rows = await db
    .select({
      card_id: kanbanCardProcesses.card_id,
      process: processesTable,
    })
    .from(kanbanCardProcesses)
    .innerJoin(
      processesTable,
      eq(kanbanCardProcesses.process_id, processesTable.id)
    )
    .where(inArray(kanbanCardProcesses.card_id, cardIds));

  for (const row of rows) {
    const existing = byCard.get(row.card_id);
    if (existing) {
      existing.push(row.process);
    } else {
      byCard.set(row.card_id, [row.process]);
    }
  }

  return byCard;
}

/**
 * Get all cards with their processes.
 * Returns both cards and potential error for proper error handling
 */
export async function getCards(): Promise<GetCardsResult> {
  try {
    const cards = await db
      .select()
      .from(kanbanCards)
      .orderBy(asc(kanbanCards.date_created));

    const byCard = await processesByCardId(cards.map((card) => card.id));

    return {
      cards: cards.map((card) => ({
        ...card,
        processes: byCard.get(card.id) ?? [],
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error fetching cards";
    console.error("[KANBAN CARDS] Error fetching cards:", message);
    return { cards: [], error: message };
  }
}

/**
 * Get a column ID by its position
 */
export async function getColumnIdByPosition(
  position: number
): Promise<string | null> {
  try {
    const columns = await getKanbanColumns();
    const column = columns.find((col) => col.position === position);
    return column?.id || DEFAULT_KANBAN_COLUMNS[0].id;
  } catch {
    console.log("[KANBAN CARDS] Error fetching config for column lookup");
    return DEFAULT_KANBAN_COLUMNS[0].id;
  }
}

/**
 * Input type for creating a card
 */
export interface CreateCardInput {
  releaseIssues?: KanbanCardRow["release_issues"];
  title: string;
  imageUrl?: string;
  assignee?: string;
  machine?: string;
  dueDate?: string;
  content?: string;
  processIds?: string[];
  quantityPerRobot?: number;
  quantityToMake?: number;
  id?: string;
  onshapeDocumentId?: string;
  onshapeInstanceType?: string;
  onshapeInstanceId?: string;
  onshapeElementId?: string;
  onshapePartId?: string;
  onshapeVersionId?: string;
  /** The part's microversion from the parts read the release came from. */
  onshapeMicroversionId?: string;
}

/**
 * Create a new Kanban card
 */
export async function createCard(
  cardData: CreateCardInput,
  actor: SessionActor
): Promise<KanbanCardRow> {
  // Get column ID for position 0
  const columnId = await getColumnIdByPosition(0);

  if (!columnId) {
    throw new Error("Could not determine target column");
  }

  const now = new Date().toISOString();
  const cardId = cardData.id || `card-${Date.now()}`;

  let card: KanbanCardRow;
  try {
    const [inserted] = await db
      .insert(kanbanCards)
      .values({
        id: cardId,
        column_id: columnId,
        title: cardData.title,
        image_url: cardData.imageUrl ?? null,
        assignee: cardData.assignee ?? null,
        date_created: now,
        date_updated: now,
        machine: cardData.machine ?? null,
        due_date: cardData.dueDate ?? null,
        content: cardData.content ?? null,
        release_issues: cardData.releaseIssues?.length
          ? cardData.releaseIssues
          : null,
        created_by: actor.onshape_user_id,
        quantity_per_robot: cardData.quantityPerRobot ?? null,
        quantity_to_make: cardData.quantityToMake ?? null,
        onshape_document_id: cardData.onshapeDocumentId ?? null,
        onshape_instance_type: cardData.onshapeInstanceType ?? null,
        onshape_instance_id: cardData.onshapeInstanceId ?? null,
        onshape_element_id: cardData.onshapeElementId ?? null,
        onshape_part_id: cardData.onshapePartId ?? null,
        onshape_version_id: cardData.onshapeVersionId ?? null,
        onshape_microversion_id: cardData.onshapeMicroversionId ?? null,
      })
      .returning();
    card = inserted;
  } catch (error) {
    console.error("[KANBAN CARDS] Error creating card:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to create card: ${message}`);
  }

  // Associate processes if provided
  if (cardData.processIds && cardData.processIds.length > 0) {
    await setCardProcesses(cardId, cardData.processIds);
  }

  publishKanbanEvent({ table: "kanban_cards", action: "insert", id: cardId });

  return card;
}

/**
 * Update an existing Kanban card
 */
export async function updateCard(
  cardId: string,
  updates: Partial<Omit<KanbanCardRow, "id" | "date_created" | "created_by">>,
  actor: SessionActor
): Promise<KanbanCardRow> {
  // If column_id is being updated, also update date_updated to track when the
  // card entered the column — but only when the column actually changes.
  if (!actor.onshape_user_id) throw new Error("Verified actor required");
  const mutableFields = new Set([
    "column_id",
    "title",
    "image_url",
    "assignee",
    "machine",
    "due_date",
    "content",
    "quantity_per_robot",
    "quantity_to_make",
  ]);
  const finalUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key]) => mutableFields.has(key))
  ) as typeof updates;
  const card = db.transaction((tx) => {
    const previous = tx
      .select()
      .from(kanbanCards)
      .where(eq(kanbanCards.id, cardId))
      .get();
    if (!previous) throw new Error("Card not found");
    if (Object.keys(finalUpdates).length === 0) return previous;
    const changed =
      finalUpdates.column_id !== undefined &&
      finalUpdates.column_id !== previous.column_id;
    if (changed) finalUpdates.date_updated = new Date().toISOString();
    const updated = tx
      .update(kanbanCards)
      .set(finalUpdates)
      .where(eq(kanbanCards.id, cardId))
      .returning()
      .get();
    if (changed) captureSlackTransition(tx, previous, updated, actor);
    return updated;
  });

  publishKanbanEvent({ table: "kanban_cards", action: "update", id: cardId });

  return card;
}

/**
 * Delete a Kanban card. The caller is responsible for removing the card's image
 * from storage — it needs the row we return to know the URL.
 */
export async function deleteCard(cardId: string): Promise<KanbanCardRow> {
  let card: KanbanCardRow | undefined;
  try {
    [card] = await db
      .delete(kanbanCards)
      .where(eq(kanbanCards.id, cardId))
      .returning();
  } catch (error) {
    console.error("[KANBAN CARDS] Error deleting card:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to delete card: ${message}`);
  }

  if (!card) {
    throw new Error("Card not found");
  }

  publishKanbanEvent({ table: "kanban_cards", action: "delete", id: cardId });

  return card;
}

/**
 * Get processes for a kanban card
 */
export async function getCardProcesses(cardId: string): Promise<ProcessRow[]> {
  try {
    const rows = await db
      .select({ process: processesTable })
      .from(kanbanCardProcesses)
      .innerJoin(
        processesTable,
        eq(kanbanCardProcesses.process_id, processesTable.id)
      )
      .where(eq(kanbanCardProcesses.card_id, cardId));

    return rows.map((row) => row.process);
  } catch (error) {
    console.error("[KANBAN CARDS] Error fetching card processes:", error);
    throw error;
  }
}

/**
 * Set processes for a kanban card (replaces existing)
 */
export async function setCardProcesses(
  cardId: string,
  processIds: string[]
): Promise<void> {
  try {
    db.transaction((tx) => {
      tx.delete(kanbanCardProcesses)
        .where(eq(kanbanCardProcesses.card_id, cardId))
        .run();

      if (processIds.length > 0) {
        tx.insert(kanbanCardProcesses)
          .values(
            processIds.map((processId) => ({
              card_id: cardId,
              process_id: processId,
            }))
          )
          .onConflictDoNothing()
          .run();
      }
    });
  } catch (error) {
    console.error("[KANBAN CARDS] Error setting card processes:", error);
    throw error;
  }
}

/**
 * Move workspace cards to the microversions a fresh parts read reports.
 *
 * A card released from a workspace keeps showing that workspace's part, so
 * when the designer edits it the card should pick up the new picture. Its
 * thumbnail is cached under `onshape_microversion_id`, so changing that is all
 * it takes; the next thumbnail request fetches the new image once. The parts
 * read was already happening in the connector, so this costs no Onshape call.
 *
 * Cards with no recorded microversion (released before microversions were
 * saved) are left alone so upgrading refetches nothing.
 */
/** The thumbnail href the connector releases with: 300x300 when offered. */
function releaseThumbnailHref(part: {
  thumbnailInfo?: { sizes?: { size?: string; href?: string }[] } | null;
}): string | undefined {
  const sizes = part.thumbnailInfo?.sizes ?? [];
  return (
    sizes.find((size) => size.size === "300x300")?.href ||
    sizes[0]?.href ||
    undefined
  );
}

const THUMBNAIL_PROXY_PREFIX = "/api/onshape/thumbnail?url=";

export function syncWorkspaceCardMicroversions(
  scope: { documentId: string; workspaceId: string; elementId: string },
  parts: {
    partId?: string;
    microversionId?: string;
    thumbnailInfo?: { sizes?: { size?: string; href?: string }[] } | null;
  }[]
): void {
  const changedIds: string[] = [];
  try {
    db.transaction((tx) => {
      for (const part of parts) {
        if (!part.partId || !part.microversionId) continue;
        // Onshape's part thumbnail href is an opaque id
        // (`/api/thumbnails/<id>/s/300x300`) that may change when the part
        // does. Cards released with an Onshape thumbnail follow the new href;
        // a card whose picture was uploaded keeps it.
        const href = releaseThumbnailHref(part);
        const changed = tx
          .update(kanbanCards)
          .set({
            onshape_microversion_id: part.microversionId,
            ...(href && {
              image_url: sql`CASE WHEN ${kanbanCards.image_url} LIKE ${THUMBNAIL_PROXY_PREFIX + "%"} THEN ${THUMBNAIL_PROXY_PREFIX + encodeURIComponent(href)} ELSE ${kanbanCards.image_url} END`,
            }),
          })
          .where(
            and(
              eq(kanbanCards.onshape_document_id, scope.documentId),
              eq(kanbanCards.onshape_instance_type, "w"),
              eq(kanbanCards.onshape_instance_id, scope.workspaceId),
              eq(kanbanCards.onshape_element_id, scope.elementId),
              eq(kanbanCards.onshape_part_id, part.partId),
              isNotNull(kanbanCards.onshape_microversion_id),
              ne(kanbanCards.onshape_microversion_id, part.microversionId)
            )
          )
          .returning({ id: kanbanCards.id })
          .all();
        changedIds.push(...changed.map((row) => row.id));
      }
    });
  } catch (error) {
    // A failed refresh leaves an older picture on the card; never fail the
    // parts read over it.
    console.error("[KANBAN CARDS] Microversion sync failed:", error);
    return;
  }
  for (const id of changedIds) {
    publishKanbanEvent({ table: "kanban_cards", action: "update", id });
  }
}
