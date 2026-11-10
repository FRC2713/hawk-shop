import "virtual:hawk-shop/server-only";
import { logServerError } from "~/server/errors";

import { desc, eq, inArray } from "drizzle-orm";
import { db } from "~/server/db/client";
import {
  equipment as equipmentTable,
  equipmentProcesses,
  kanbanCards,
  processes as processesTable,
} from "~/server/db/schema";
import { publishKanbanEvent } from "~/server/events/bus";
import type {
  EquipmentRow,
  EquipmentWithProcesses,
  ProcessRow,
} from "~/server/db/types";
import { deleteEquipmentImage } from "./images";

/**
 * Result type for getEquipment to distinguish errors from empty results
 */
export interface GetEquipmentResult {
  equipment: EquipmentWithProcesses[];
  error?: string;
  errorId?: string;
}

/**
 * Load the process rows attached to each of `equipmentIds`, keyed by equipment id.
 */
async function processesByEquipmentId(
  equipmentIds: string[]
): Promise<Map<string, ProcessRow[]>> {
  const byEquipment = new Map<string, ProcessRow[]>();
  if (equipmentIds.length === 0) return byEquipment;

  const rows = await db
    .select({
      equipment_id: equipmentProcesses.equipment_id,
      process: processesTable,
    })
    .from(equipmentProcesses)
    .innerJoin(
      processesTable,
      eq(equipmentProcesses.process_id, processesTable.id)
    )
    .where(inArray(equipmentProcesses.equipment_id, equipmentIds));

  for (const row of rows) {
    const existing = byEquipment.get(row.equipment_id);
    if (existing) {
      existing.push(row.process);
    } else {
      byEquipment.set(row.equipment_id, [row.process]);
    }
  }

  return byEquipment;
}

/**
 * Get all equipment with their processes.
 * Returns both equipment and potential error for proper error handling
 */
export async function getEquipment(): Promise<GetEquipmentResult> {
  try {
    const rows = await db
      .select()
      .from(equipmentTable)
      .orderBy(desc(equipmentTable.created_at));

    const byEquipment = await processesByEquipmentId(rows.map((row) => row.id));

    return {
      equipment: rows.map((row) => ({
        ...row,
        processes: byEquipment.get(row.id) ?? [],
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching equipment";
    const errorId = logServerError("EQUIPMENT", error);
    return { equipment: [], error: message, errorId };
  }
}

/**
 * Get a single equipment item by ID with processes
 */
export async function getEquipmentById(
  id: string
): Promise<EquipmentWithProcesses | null> {
  try {
    const [row] = await db
      .select()
      .from(equipmentTable)
      .where(eq(equipmentTable.id, id))
      .limit(1);

    if (!row) {
      return null;
    }

    const byEquipment = await processesByEquipmentId([row.id]);

    return { ...row, processes: byEquipment.get(row.id) ?? [] };
  } catch (error) {
    console.error("[EQUIPMENT] Error fetching equipment:", error);
    throw error;
  }
}

/**
 * Input type for creating equipment
 */
export interface CreateEquipmentInput {
  name: string;
  description?: string;
  location?: string;
  status?: string;
  documentationUrl?: string;
  imageUrls?: string[];
  processIds?: string[];
  id?: string;
}

/**
 * Create a new equipment item
 */
export async function createEquipment(
  equipmentData: CreateEquipmentInput
): Promise<EquipmentRow> {
  const now = new Date().toISOString();
  const equipmentId =
    equipmentData.id ||
    `equipment-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  let created: EquipmentRow;
  try {
    const [row] = await db
      .insert(equipmentTable)
      .values({
        id: equipmentId,
        name: equipmentData.name,
        description: equipmentData.description ?? null,
        location: equipmentData.location ?? null,
        status: equipmentData.status ?? null,
        documentation_url: equipmentData.documentationUrl ?? null,
        image_urls: equipmentData.imageUrls ?? null,
        created_at: now,
        updated_at: now,
      })
      .returning();
    created = row;
  } catch (error) {
    console.error("[EQUIPMENT] Error creating equipment:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to create equipment: ${message}`);
  }

  // Associate processes if provided
  if (equipmentData.processIds && equipmentData.processIds.length > 0) {
    await setEquipmentProcesses(equipmentId, equipmentData.processIds);
  }

  return created;
}

/**
 * Update an existing equipment item.
 *
 * Cards name their equipment by text in `kanban_cards.machine`, so a rename
 * moves those cards to the new name in the same transaction.
 */
export async function updateEquipment(
  equipmentId: string,
  updates: Partial<Omit<EquipmentRow, "id" | "created_at">>
): Promise<EquipmentRow> {
  let updated: EquipmentRow | undefined;
  let renamedCards = 0;
  try {
    db.transaction((tx) => {
      const previous = tx
        .select({ name: equipmentTable.name })
        .from(equipmentTable)
        .where(eq(equipmentTable.id, equipmentId))
        .get();
      if (!previous) return;
      updated = tx
        .update(equipmentTable)
        .set({ ...updates, updated_at: new Date().toISOString() })
        .where(eq(equipmentTable.id, equipmentId))
        .returning()
        .get();
      if (updates.name !== undefined && updates.name !== previous.name) {
        renamedCards = tx
          .update(kanbanCards)
          .set({ machine: updates.name })
          .where(eq(kanbanCards.machine, previous.name))
          .run().changes;
      }
    });
  } catch (error) {
    console.error("[EQUIPMENT] Error updating equipment:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to update equipment: ${message}`);
  }

  if (!updated) {
    throw new Error("Equipment not found");
  }
  if (renamedCards > 0) {
    publishKanbanEvent({ table: "kanban_cards", action: "update" });
  }

  return updated;
}

/**
 * Flag equipment for maintenance with a note, or clear the flag (`null`).
 * A flag never blocks assigning parts to the equipment.
 */
export async function setEquipmentMaintenance(
  equipmentId: string,
  maintenance: { note: string; reportedBy: string } | null
): Promise<EquipmentRow> {
  return updateEquipment(
    equipmentId,
    maintenance
      ? {
          status: "maintenance",
          maintenance_note: maintenance.note,
          maintenance_reported_by: maintenance.reportedBy,
          maintenance_reported_at: new Date().toISOString(),
        }
      : {
          status: null,
          maintenance_note: null,
          maintenance_reported_by: null,
          maintenance_reported_at: null,
        }
  );
}

/**
 * Delete an equipment item, along with all of its images. Cards assigned to it
 * go back to no machine.
 */
export async function deleteEquipment(
  equipmentId: string
): Promise<EquipmentRow> {
  let deleted: EquipmentRow | undefined;
  let clearedCards = 0;
  try {
    db.transaction((tx) => {
      deleted = tx
        .delete(equipmentTable)
        .where(eq(equipmentTable.id, equipmentId))
        .returning()
        .get();
      if (!deleted) return;
      clearedCards = tx
        .update(kanbanCards)
        .set({ machine: null })
        .where(eq(kanbanCards.machine, deleted.name))
        .run().changes;
    });
  } catch (error) {
    console.error("[EQUIPMENT] Error deleting equipment:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to delete equipment: ${message}`);
  }

  if (!deleted) {
    throw new Error("Equipment not found");
  }
  if (clearedCards > 0) {
    publishKanbanEvent({ table: "kanban_cards", action: "update" });
  }

  // Row is gone; clean the images up after the fact so a storage failure can't
  // leave a half-deleted record behind.
  for (const imageUrl of deleted.image_urls ?? []) {
    await deleteEquipmentImage(imageUrl);
  }

  return deleted;
}

/**
 * Get processes for an equipment item
 */
export async function getEquipmentProcesses(
  equipmentId: string
): Promise<ProcessRow[]> {
  try {
    const rows = await db
      .select({ process: processesTable })
      .from(equipmentProcesses)
      .innerJoin(
        processesTable,
        eq(equipmentProcesses.process_id, processesTable.id)
      )
      .where(eq(equipmentProcesses.equipment_id, equipmentId));

    return rows.map((row) => row.process);
  } catch (error) {
    console.error("[EQUIPMENT] Error fetching equipment processes:", error);
    throw error;
  }
}

/**
 * Set processes for an equipment item (replaces existing)
 */
export async function setEquipmentProcesses(
  equipmentId: string,
  processIds: string[]
): Promise<void> {
  try {
    db.transaction((tx) => {
      tx.delete(equipmentProcesses)
        .where(eq(equipmentProcesses.equipment_id, equipmentId))
        .run();

      if (processIds.length > 0) {
        tx.insert(equipmentProcesses)
          .values(
            processIds.map((processId) => ({
              equipment_id: equipmentId,
              process_id: processId,
            }))
          )
          .onConflictDoNothing()
          .run();
      }
    });
  } catch (error) {
    console.error("[EQUIPMENT] Error setting equipment processes:", error);
    throw error;
  }
}
