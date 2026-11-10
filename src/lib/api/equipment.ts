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
        equipment: EquipmentWithProcesses[];
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

/** Uploads run concurrently; one rejection fails the whole batch. */
export async function uploadEquipmentImages(
  id: string,
  files: File[]
): Promise<void> {
  await Promise.all(
    files.map((file) => {
      const body = new FormData();
      body.append("file", file);
      return apiFetch(`/api/equipment/${id}/image`, {
        method: "POST",
        body,
        fallbackError: "Failed to upload image",
      });
    })
  );
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
