import { queryOptions } from "@tanstack/react-query";
import type {
  CardMachine,
  CardProject,
  KanbanCardRow,
  ProcessRow,
  ReviewNoteRow,
  StatusHistoryRow,
} from "~/server/db/types";
import type {
  KanbanColumn,
  KanbanConfig,
} from "~/server/kanbanApi/columnTypes";
import {
  needsOnshapeSnapshot,
  type CardSnapshot,
  type CardSnapshotFields,
} from "~/lib/cardSnapshot";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

/**
 * `/api/kanban/cards` joins each card to its processes, project, machine and
 * review notes (why it was sent back, oldest first).
 */
export type KanbanCardWithProcesses = KanbanCardRow & {
  processes?: ProcessRow[];
  project?: CardProject | null;
  linked_machine?: CardMachine | null;
  review_notes?: ReviewNoteRow[];
};

/** `/api/kanban/cards/:id`: one card with its permanent status history. */
export type KanbanCardWithHistory = KanbanCardWithProcesses & {
  status_history: StatusHistoryRow[];
};

/** Fields `/api/kanban/cards/:id` accepts on PATCH. */
export interface KanbanCardUpdate {
  column_id?: string;
  /** Equipment id; null clears the machine. */
  machine_id?: string | null;
  due_date?: string | null;
  quantity_to_make?: number;
  project_id?: string;
  /** The submitter's notes; blank clears them. */
  content?: string | null;
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

/** Card details include permanent history without loading it for the whole board. */
export function kanbanCardDetailsQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.kanban.cardDetails(id),
    queryFn: async () => {
      const { card } = await apiFetch<{ card: KanbanCardWithHistory }>(
        `/api/kanban/cards/${encodeURIComponent(id)}`,
        {
          fallbackError: "Failed to load status history",
        }
      );
      return card;
    },
  });
}

/**
 * A card's Onshape snapshot (material, version name). Runs only for a card
 * released before snapshots existed: the server fills it once and saves it, so
 * every other card answers from its own row without this request.
 */
export function kanbanCardSnapshotQuery(
  card: CardSnapshotFields & { id: string }
) {
  return queryOptions({
    queryKey: queryKeys.kanban.cardSnapshot(card.id),
    queryFn: () =>
      apiFetch<CardSnapshot>(
        `/api/kanban/cards/${encodeURIComponent(card.id)}/snapshot`,
        { method: "POST", fallbackError: "Failed to load part details" }
      ),
    enabled: needsOnshapeSnapshot(card),
    staleTime: Infinity,
    retry: false,
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

/**
 * Assign cards to a machine, or with null return them to their process queue.
 * All or nothing: a machine under maintenance, or one lacking a card's process,
 * is refused (409) and no card changes.
 */
export async function assignCardsToMachine(
  cardIds: string[],
  machineId: string | null
): Promise<KanbanCardWithProcesses[]> {
  const { cards } = await apiFetch<{ cards: KanbanCardWithProcesses[] }>(
    "/api/kanban/cards/assign-machine",
    {
      method: "POST",
      json: { cardIds, machineId },
      fallbackError: "Failed to set machine",
    }
  );
  return cards;
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
