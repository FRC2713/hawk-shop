import "virtual:hawk-shop/server-only";
import { logServerError } from "~/server/errors";

import {
  captureSlackProjectChange,
  captureSlackRelease,
  captureSlackRemoval,
  captureSlackTransition,
} from "~/lib/slack/queue";
import type { SessionActor } from "~/lib/sessionActor";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "~/server/db/client";
import {
  DEFAULT_KANBAN_COLUMNS,
  equipment as equipmentTable,
  kanbanCardProcesses,
  kanbanCards,
  kanbanConfig,
  MISCELLANEOUS_PROJECT_ID,
  projects as projectsTable,
  statusHistory,
  users,
  processes as processesTable,
} from "~/server/db/schema";
import { getKanbanColumns } from "~/server/kanbanApi/config";
import { publishKanbanEvent } from "~/server/events/bus";
import type {
  KanbanCardRow,
  KanbanCardWithProcesses,
  ProcessRow,
} from "~/server/db/types";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown when a card names a project that doesn't exist. */
export class UnknownProjectError extends Error {
  constructor() {
    super("Unknown project");
  }
}

/** Thrown when a card names a machine that isn't an equipment record. */
export class UnknownMachineError extends Error {
  constructor() {
    super("Unknown machine");
  }
}

function requireMachine(tx: Transaction, id: string | null) {
  if (id === null) return;
  const machine = tx
    .select({ id: equipmentTable.id })
    .from(equipmentTable)
    .where(eq(equipmentTable.id, id))
    .get();
  if (!machine) throw new UnknownMachineError();
}

export class InvalidNotesError extends Error {
  constructor() {
    super("Notes must be text");
  }
}

function requireProject(tx: Transaction, id: string) {
  const project = tx
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id))
    .get();
  if (!project) throw new UnknownProjectError();
  return project;
}

function captureStatusHistory(
  tx: Transaction,
  previous: KanbanCardRow | null,
  card: KanbanCardRow,
  actor: SessionActor
) {
  const columns = (
    tx.select().from(kanbanConfig).where(eq(kanbanConfig.id, "default")).get()
      ?.columns ?? DEFAULT_KANBAN_COLUMNS
  )
    .slice()
    .sort((a, b) => a.position - b.position);
  const status = (id: string) =>
    columns.find((column) => column.id === id)?.title ?? id;
  const actorName = tx
    .select()
    .from(users)
    .where(eq(users.onshape_user_id, actor.onshape_user_id))
    .get()?.name;
  tx.insert(statusHistory)
    .values({
      card_id: card.id,
      card_title: card.title,
      from_column_id: previous?.column_id ?? null,
      to_column_id: card.column_id,
      from_status: previous ? status(previous.column_id) : null,
      to_status: status(card.column_id),
      from_column_index: previous
        ? columns.findIndex((column) => column.id === previous.column_id)
        : null,
      to_column_index: columns.findIndex(
        (column) => column.id === card.column_id
      ),
      actor_id: actor.onshape_user_id,
      actor_name: actor.name || actorName || "Unknown member",
      moved_at: previous ? card.date_updated : card.date_created,
    })
    .run();
}

/** Also reads archived history after the card has been deleted. */
export async function getCardStatusHistory(cardId: string) {
  return db
    .select()
    .from(statusHistory)
    .where(eq(statusHistory.card_id, cardId))
    .orderBy(asc(statusHistory.moved_at), asc(statusHistory.id))
    .all();
}

/**
 * Result type for getCards to distinguish errors from empty results
 */
export interface GetCardsResult {
  cards: KanbanCardWithProcesses[];
  error?: string;
  errorId?: string;
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
    const projectById = new Map(
      db
        .select({
          id: projectsTable.id,
          name: projectsTable.name,
          archived_at: projectsTable.archived_at,
        })
        .from(projectsTable)
        .all()
        .map((project) => [project.id, project])
    );

    const machineById = new Map(
      db
        .select({
          id: equipmentTable.id,
          name: equipmentTable.name,
          status: equipmentTable.status,
        })
        .from(equipmentTable)
        .all()
        .map((machine) => [machine.id, machine])
    );

    return {
      cards: cards.map((card) => ({
        ...card,
        processes: byCard.get(card.id) ?? [],
        project: projectById.get(card.project_id) ?? null,
        linked_machine: card.machine_id
          ? (machineById.get(card.machine_id) ?? null)
          : null,
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error fetching cards";
    const errorId = logServerError("KANBAN CARDS", error);
    return { cards: [], error: message, errorId };
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
  /** Equipment id. Cards no longer take machine text. */
  machineId?: string | null;
  dueDate?: string;
  content?: string;
  processIds?: string[];
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
  /** Material display name captured at release; "" when none was set. */
  onshapeMaterial?: string;
  /** Version name captured at release. */
  onshapeVersionName?: string;
  /** Defaults to Miscellaneous. */
  projectId?: string;
}

/**
 * Create a new Kanban card
 */
export async function createCard(
  cardData: CreateCardInput,
  actor: SessionActor
): Promise<KanbanCardRow> {
  if (!actor.onshape_user_id) throw new Error("Verified actor required");
  // Get column ID for position 0
  const columnId = await getColumnIdByPosition(0);

  if (!columnId) {
    throw new Error("Could not determine target column");
  }

  const now = new Date().toISOString();
  const cardId = cardData.id || `card-${Date.now()}`;

  let card: KanbanCardRow;
  try {
    card = db.transaction((tx) => {
      const project = requireProject(
        tx,
        cardData.projectId || MISCELLANEOUS_PROJECT_ID
      );
      requireMachine(tx, cardData.machineId ?? null);
      const inserted = tx
        .insert(kanbanCards)
        .values({
          id: cardId,
          column_id: columnId,
          title: cardData.title,
          image_url: cardData.imageUrl ?? null,
          assignee: cardData.assignee ?? null,
          date_created: now,
          date_updated: now,
          machine_id: cardData.machineId ?? null,
          due_date: cardData.dueDate ?? null,
          content: cardData.content ?? null,
          release_issues: cardData.releaseIssues?.length
            ? cardData.releaseIssues
            : null,
          created_by: actor.onshape_user_id,
          quantity_to_make: cardData.quantityToMake ?? null,
          onshape_document_id: cardData.onshapeDocumentId ?? null,
          onshape_instance_type: cardData.onshapeInstanceType ?? null,
          onshape_instance_id: cardData.onshapeInstanceId ?? null,
          onshape_element_id: cardData.onshapeElementId ?? null,
          onshape_part_id: cardData.onshapePartId ?? null,
          onshape_version_id: cardData.onshapeVersionId ?? null,
          onshape_microversion_id: cardData.onshapeMicroversionId ?? null,
          onshape_material: cardData.onshapeMaterial ?? null,
          onshape_version_name: cardData.onshapeVersionName ?? null,
          project_id: project.id,
        })
        .returning()
        .get();
      captureStatusHistory(tx, null, inserted, actor);
      const processNames = cardData.processIds?.length
        ? tx
            .select({ name: processesTable.name })
            .from(processesTable)
            .where(inArray(processesTable.id, cardData.processIds))
            .all()
            .map((row) => row.name)
        : [];
      captureSlackRelease(tx, inserted, actor, processNames, project.name);
      return inserted;
    });
  } catch (error) {
    if (
      error instanceof UnknownProjectError ||
      error instanceof UnknownMachineError
    )
      throw error;
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
    "machine_id",
    "due_date",
    "content",
    "quantity_to_make",
    "project_id",
  ]);
  const finalUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key]) => mutableFields.has(key))
  ) as typeof updates;
  // `content` holds the submitter's notes; blank text means no notes.
  if (finalUpdates.content !== undefined) {
    const notes: unknown = finalUpdates.content;
    if (notes !== null && typeof notes !== "string")
      throw new InvalidNotesError();
    finalUpdates.content = notes?.trim() || null;
  }
  const card = db.transaction((tx) => {
    const previous = tx
      .select()
      .from(kanbanCards)
      .where(eq(kanbanCards.id, cardId))
      .get();
    if (!previous) throw new Error("Card not found");
    if (Object.keys(finalUpdates).length === 0) return previous;
    if (finalUpdates.project_id !== undefined)
      requireProject(tx, finalUpdates.project_id);
    if (finalUpdates.machine_id !== undefined) {
      requireMachine(tx, finalUpdates.machine_id);
      // Picking or clearing a machine settles any legacy text.
      finalUpdates.machine = null;
      // A queue position was set in the old machine's queue; it doesn't
      // follow the part to another one.
      if (finalUpdates.machine_id !== previous.machine_id)
        finalUpdates.queue_position = null;
    }
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
    if (changed) {
      captureStatusHistory(tx, previous, updated, actor);
      captureSlackTransition(tx, previous, updated, actor);
    }
    // Not a status change: no history, no reply. The release message is
    // edited to show the new project instead.
    if (updated.project_id !== previous.project_id)
      captureSlackProjectChange(tx, updated, actor);
    return updated;
  });

  publishKanbanEvent({ table: "kanban_cards", action: "update", id: cardId });

  return card;
}

/**
 * Delete a Kanban card. The caller is responsible for removing the card's image
 * from storage — it needs the row we return to know the URL.
 */
export async function deleteCard(
  cardId: string,
  actor: SessionActor | null = null
): Promise<KanbanCardRow> {
  let card: KanbanCardRow | undefined;
  try {
    card = db.transaction((tx) => {
      const deleted = tx
        .delete(kanbanCards)
        .where(eq(kanbanCards.id, cardId))
        .returning()
        .get();
      if (deleted) captureSlackRemoval(tx, deleted, actor);
      return deleted;
    });
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
