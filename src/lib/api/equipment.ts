import type { EquipmentListItem } from "~/lib/equipment";
import { queryOptions } from "@tanstack/react-query";
import type { EquipmentRow, ProcessRow } from "~/server/db/types";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

/** `/api/equipment` joins each row to its processes; the UI relies on that. */
export type EquipmentWithProcesses = EquipmentRow & {
  processes?: ProcessRow[];
};

/**
 * The fields `/api/equipment` accepts on create and update. Blank optional
 * strings are sent as `null` so an edit can clear them; the handler stores
 * `null` for them on create too.
 */
export interface EquipmentInput {
  name: string;
  description?: string;
  processIds?: string[];
  location?: string;
  documentationUrl?: string;
}

const blankToNull = (value: string | undefined) =>
  value && value.trim() ? value.trim() : null;

function toPayload(input: EquipmentInput) {
  return {
    name: input.name,
    description: blankToNull(input.description),
    processIds: input.processIds || [],
    location: blankToNull(input.location),
    documentationUrl: blankToNull(input.documentationUrl),
  };
}

export function equipmentQuery() {
  return queryOptions({
    queryKey: queryKeys.equipment.all(),
    queryFn: async () => {
      const { equipment } = await apiFetch<{
        equipment: EquipmentListItem[];
      }>("/api/equipment", { fallbackError: "Failed to fetch equipment" });
      return equipment;
    },
  });
}

export async function createEquipment(
  input: EquipmentInput
): Promise<EquipmentRow> {
  const { equipment } = await apiFetch<{ equipment: EquipmentRow }>(
    "/api/equipment",
    {
      method: "POST",
      json: toPayload(input),
      fallbackError: "Failed to create equipment",
    }
  );
  return equipment;
}

export async function updateEquipment(
  id: string,
  input: EquipmentInput
): Promise<EquipmentRow> {
  const { equipment } = await apiFetch<{ equipment: EquipmentRow }>(
    `/api/equipment/${id}`,
    {
      method: "PUT",
      json: toPayload(input),
      fallbackError: "Failed to update equipment",
    }
  );
  return equipment;
}

export async function deleteEquipment(id: string): Promise<void> {
  await apiFetch(`/api/equipment/${id}`, {
    method: "DELETE",
    fallbackError: "Failed to delete equipment",
  });
}

/** Sequential uploads preserve selection order and avoid lost appends. */
export async function uploadEquipmentImages(
  id: string,
  files: File[]
): Promise<void> {
  for (const file of files) await uploadEquipmentPhoto(id, file);
}

export async function uploadEquipmentPhoto(
  id: string,
  file: File
): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const { imageUrl } = await apiFetch<{ imageUrl: string }>(
    `/api/equipment/${id}/image`,
    {
      method: "POST",
      body,
      fallbackError: "Failed to upload image",
    }
  );
  return imageUrl;
}

export async function reorderEquipmentImages(
  id: string,
  imageUrls: string[]
): Promise<void> {
  await apiFetch(`/api/equipment/${id}/image`, {
    method: "PUT",
    json: { imageUrls },
    fallbackError: "Failed to reorder photos",
  });
}

export async function deleteEquipmentImage(
  id: string,
  imageUrl: string
): Promise<void> {
  await apiFetch(
    `/api/equipment/${id}/image?imageUrl=${encodeURIComponent(imageUrl)}`,
    { method: "DELETE", fallbackError: "Failed to delete image" }
  );
}

/** Equipment flagged for maintenance stays assignable; the flag is information. */
export function needsMaintenance(item: Pick<EquipmentRow, "status">): boolean {
  return item.status === "maintenance";
}

export async function flagEquipmentMaintenance(
  id: string,
  note: string
): Promise<void> {
  await apiFetch(`/api/equipment/${id}/maintenance`, {
    method: "POST",
    json: { note },
    fallbackError: "Failed to flag equipment",
  });
}

export async function clearEquipmentMaintenance(id: string): Promise<void> {
  await apiFetch(`/api/equipment/${id}/maintenance`, {
    method: "DELETE",
    fallbackError: "Failed to clear the maintenance flag",
  });
}

/** #118's derived Backlog queue, including compatible unassigned parts. */
export function machineQueueQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.kanban.machineQueue(id),
    queryFn: async () => {
      const { cards } = await apiFetch<{
        cards: import("./kanban").KanbanCardWithProcesses[];
      }>(`/api/equipment/${encodeURIComponent(id)}/queue`, {
        fallbackError: "Failed to load machine queue",
      });
      return cards;
    },
  });
}

export async function reorderMachineQueue(
  machineId: string,
  cardIds: string[]
) {
  const { cards } = await apiFetch<{
    cards: import("./kanban").KanbanCardWithProcesses[];
  }>("/api/kanban/cards/reorder", {
    method: "POST",
    json: { machineId, cardIds },
    fallbackError: "Failed to reorder queue",
  });
  return cards;
}
