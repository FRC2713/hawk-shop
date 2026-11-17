import { queryOptions } from "@tanstack/react-query";
import type { EquipmentRow, ProcessRow } from "~/server/db/types";
import { apiFetch } from "./client";
import type { KanbanCardWithProcesses } from "./kanban";
import { queryKeys } from "./keys";

/**
 * The #118 workflow actions (machine assignment is `assignCardsToMachine` in
 * `kanban.ts`). Each answers the changed card; a conflict (the
 * part moved, someone else claimed it, the machine can't take it) is an
 * `ApiError` with status 409 and the server's message.
 */

function cardAction(id: string, action: string, fallbackError: string) {
  return async (json?: unknown): Promise<KanbanCardWithProcesses> => {
    const { card } = await apiFetch<{ card: KanbanCardWithProcesses }>(
      `/api/kanban/cards/${encodeURIComponent(id)}/${action}`,
      { method: "POST", json: json ?? {}, fallbackError }
    );
    return card;
  };
}

/** Claim a part as the signed-in member, optionally at a machine. */
export function claimCard(id: string, options: { machineId?: string } = {}) {
  return cardAction(id, "claim", "Failed to claim part")(options);
}

export function unclaimCard(id: string) {
  return cardAction(id, "unclaim", "Failed to unclaim part")();
}

/** In Progress → Review. */
export function markCardDone(id: string) {
  return cardAction(id, "done", "Failed to send part to review")();
}

/** Review → Done. */
export function approveCard(id: string) {
  return cardAction(id, "approve", "Failed to approve part")();
}

/** Review → In Progress or Backlog, keeping `reason` as a review note. */
export function sendCardBack(id: string, reason: string) {
  return cardAction(id, "send-back", "Failed to send part back")({ reason });
}

/** Backlog parts assigned to a machine, then process-queue parts it can make. */
export function machineQueueQuery(machineId: string) {
  return queryOptions({
    queryKey: queryKeys.kanban.machineQueue(machineId),
    queryFn: () =>
      apiFetch<{ machine: EquipmentRow; cards: KanbanCardWithProcesses[] }>(
        `/api/equipment/${encodeURIComponent(machineId)}/queue`,
        { fallbackError: "Failed to load queue" }
      ),
  });
}

/** Backlog parts with this process and no machine. */
export function processQueueQuery(processId: string) {
  return queryOptions({
    queryKey: queryKeys.kanban.processQueue(processId),
    queryFn: () =>
      apiFetch<{ process: ProcessRow; cards: KanbanCardWithProcesses[] }>(
        `/api/processes/${encodeURIComponent(processId)}/queue`,
        { fallbackError: "Failed to load queue" }
      ),
  });
}
