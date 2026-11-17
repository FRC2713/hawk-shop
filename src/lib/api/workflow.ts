import { apiFetch } from "./client";
import type { KanbanCardWithProcesses } from "./kanban";

/**
 * The #118 workflow actions. Machine assignment is `assignCardsToMachine` in
 * `kanban.ts`; machine queues are `machineQueueQuery` in `equipment.ts`.
 * Each action answers the changed card; a conflict (the part moved, someone
 * else claimed it, the machine can't take it) is an `ApiError` with status
 * 409 and the server's message.
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
