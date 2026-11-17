import "virtual:hawk-shop/server-only";

import { eq } from "drizzle-orm";
import { db } from "~/server/db/client";
import {
  DEFAULT_KANBAN_COLUMNS,
  kanbanConfig,
  type KanbanColumnConfig,
} from "~/server/db/schema";
import { publishKanbanEvent } from "~/server/events/bus";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

/**
 * Kanban columns are a JSON blob on the single `kanban_config` row with
 * id = 'default', not a table. Card `column_id` values are the ids in that blob.
 */
export const CONFIG_ID = "default";

export type KanbanColumn = KanbanColumnConfig;

export interface KanbanConfig {
  columns: KanbanColumn[];
}

export const DEFAULT_CONFIG: KanbanConfig = {
  columns: DEFAULT_KANBAN_COLUMNS,
};

/**
 * Read the configured columns, falling back to the defaults if the row is
 * missing or unreadable. The board must always have columns to render.
 */
export async function getKanbanColumns(): Promise<KanbanColumn[]> {
  try {
    const [row] = await db
      .select({ columns: kanbanConfig.columns })
      .from(kanbanConfig)
      .where(eq(kanbanConfig.id, CONFIG_ID))
      .limit(1);

    if (!row || !Array.isArray(row.columns) || row.columns.length === 0) {
      console.log("[KANBAN CONFIG] No existing config found, using default");
      return DEFAULT_KANBAN_COLUMNS;
    }

    return row.columns;
  } catch (error) {
    console.log("[KANBAN CONFIG] Error fetching columns:", error);
    return DEFAULT_KANBAN_COLUMNS;
  }
}

export async function getKanbanConfig(): Promise<KanbanConfig> {
  return { columns: await getKanbanColumns() };
}

/** A save would delete a column that shop workflow actions move cards to. */
export class WorkflowColumnRemovedError extends Error {}

export async function saveKanbanConfig(config: KanbanConfig): Promise<void> {
  const kept = new Set(config.columns.map((column) => column.id));
  const removed = Object.values(WORKFLOW_COLUMN_IDS).filter(
    (id) => !kept.has(id)
  );
  if (removed.length) {
    const current = await getKanbanColumns();
    const titles = removed.map(
      (id) =>
        current.find((column) => column.id === id)?.title ??
        DEFAULT_KANBAN_COLUMNS.find((column) => column.id === id)?.title ??
        id
    );
    throw new WorkflowColumnRemovedError(
      `${titles.join(", ")} can be renamed but not deleted: claiming, review and approval move parts there`
    );
  }
  try {
    await db
      .insert(kanbanConfig)
      .values({ id: CONFIG_ID, columns: config.columns })
      .onConflictDoUpdate({
        target: kanbanConfig.id,
        set: { columns: config.columns },
      });
  } catch (error) {
    console.error("[KANBAN CONFIG] Error saving config:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to save config: ${message}`);
  }

  publishKanbanEvent({ table: "kanban_config", action: "update" });
  console.log("[KANBAN CONFIG] Saved config to database");
}
