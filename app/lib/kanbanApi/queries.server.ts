import "server-only";
import { getCards } from "./cards";
import { getKanbanColumns } from "./config";
import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import type { KanbanCardWithProcesses } from "~/lib/db/types";

/**
 * Server-side function to fetch kanban cards
 * Used for prefetching in server components
 */
export async function fetchKanbanCardsServer(): Promise<{
  cards: KanbanCardWithProcesses[];
}> {
  const result = await getCards();
  if (result.error) {
    console.error("[KANBAN CARDS] Error fetching cards:", result.error);
    return { cards: [] };
  }
  return { cards: result.cards };
}

/**
 * Server-side function to fetch kanban columns
 * Used for prefetching in server components
 */
export async function fetchKanbanColumnsServer(): Promise<KanbanColumn[]> {
  return getKanbanColumns();
}
