import { queryOptions } from "@tanstack/react-query";
import type { KanbanCardRow, ProcessRow } from "~/lib/db/types";
import type { KanbanColumn, KanbanConfig } from "~/lib/kanbanApi/columnTypes";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

/** `/api/kanban/cards` joins each card to its processes. */
export type KanbanCardWithProcesses = KanbanCardRow & {
  processes?: ProcessRow[];
};

/** Fields `/api/kanban/cards/:id` accepts on PATCH. */
export interface KanbanCardUpdate {
  column_id?: string;
  machine?: string | null;
  due_date?: string | null;
  quantity_per_robot?: number;
  quantity_to_make?: number;
  processIds?: string[];
}

export function kanbanConfigQuery() {
  return queryOptions({
    queryKey: queryKeys.kanban.config(),
    queryFn: () =>
      apiFetch<KanbanConfig>("/api/kanban/config", {
        fallbackError: "Failed to fetch Kanban config",
      }),
    staleTime: 60 * 1000,
  });
}

/**
 * Returns the cards array directly. The handler wraps it in `{ cards }`; that
 * wrapper stopped at this module so the optimistic updates in `KanbanBoard`
 * operate on a plain list.
 */
export function kanbanCardsQuery() {
  return queryOptions({
    queryKey: queryKeys.kanban.cards(),
    queryFn: async () => {
      const { cards } = await apiFetch<{ cards: KanbanCardWithProcesses[] }>(
        "/api/kanban/cards",
        { fallbackError: "Failed to fetch cards" }
      );
      return cards;
    },
    staleTime: 30 * 1000,
  });
}

export function kanbanColumnsQuery() {
  return queryOptions({
    queryKey: queryKeys.kanban.columns(),
    queryFn: () =>
      apiFetch<KanbanColumn[]>("/api/kanban/config/columns", {
        fallbackError: "Failed to fetch columns",
      }),
    staleTime: 60 * 1000,
  });
}

export async function saveKanbanConfig(
  config: KanbanConfig
): Promise<KanbanConfig> {
  const result = await apiFetch<{ success: boolean; config: KanbanConfig }>(
    "/api/kanban/config",
    {
      method: "PUT",
      json: config,
      fallbackError: "Failed to save configuration",
    }
  );
  return result.config;
}

export async function updateKanbanCard(
  id: string,
  updates: KanbanCardUpdate
): Promise<KanbanCardWithProcesses> {
  const { card } = await apiFetch<{ card: KanbanCardWithProcesses }>(
    `/api/kanban/cards/${id}`,
    {
      method: "PATCH",
      json: updates,
      fallbackError: "Failed to update card",
    }
  );
  return card;
}

export async function deleteKanbanCard(id: string): Promise<void> {
  await apiFetch(`/api/kanban/cards/${id}`, {
    method: "DELETE",
    fallbackError: "Failed to delete card",
  });
}

export async function assignKanbanCard(
  id: string,
  assignee: string | null
): Promise<KanbanCardWithProcesses> {
  const { card } = await apiFetch<{ card: KanbanCardWithProcesses }>(
    `/api/kanban/cards/${id}/assign`,
    {
      method: "POST",
      json: { assignee },
      fallbackError: "Failed to assign card",
    }
  );
  return card;
}
