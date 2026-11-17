import { apiFetch } from "./client";
import type { KanbanCardWithProcesses } from "./kanban";

/**
 * The shop workflow actions on one part. Each answers with the updated card,
 * or throws an `ApiError` carrying the server's reason (409 when the part's
 * status doesn't allow the action).
 */
async function workflowAction(
  id: string,
  action: string,
  fallbackError: string,
  json: unknown = {}
): Promise<KanbanCardWithProcesses> {
  const { card } = await apiFetch<{ card: KanbanCardWithProcesses }>(
    `/api/kanban/cards/${encodeURIComponent(id)}/${action}`,
    { method: "POST", json, fallbackError }
  );
  return card;
}

/** Claim a part for the signed-in member, or `userId` on a shared screen. */
export function claimCard(
  id: string,
  options: { machineId?: string; userId?: string } = {}
) {
  return workflowAction(id, "claim", "Failed to claim part", options);
}

export function unclaimCard(id: string) {
  return workflowAction(id, "unclaim", "Failed to unclaim part");
}

/** In Progress → Review. */
export function markCardDone(id: string) {
  return workflowAction(id, "done", "Failed to mark part done");
}

/** Review → Done. */
export function approveCard(id: string) {
  return workflowAction(id, "approve", "Failed to approve part");
}

/** Review → back to work; `reason` is required and kept as a review note. */
export function sendCardBack(id: string, reason: string) {
  return workflowAction(id, "send-back", "Failed to send part back", {
    reason,
  });
}
