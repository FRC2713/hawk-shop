import { queryOptions } from "@tanstack/react-query";
import type { EquipmentRow, ProcessRow } from "~/lib/db/types";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

/** `/api/equipment` joins each row to its processes; the UI relies on that. */
export type EquipmentWithProcesses = EquipmentRow & {
  processes?: ProcessRow[];
};

/**
 * The fields `/api/equipment` accepts on create and update. Blank strings are
 * normalized away here rather than at each call site, because the dialogs bind
 * their inputs to `""` and the handler wants them absent.
 */
export interface EquipmentInput {
  name: string;
  description?: string;
  processIds?: string[];
  location?: string;
  status?: string;
  documentationUrl?: string;
}

function toPayload(input: EquipmentInput) {
  return {
    name: input.name,
    description: input.description || undefined,
    processIds: input.processIds || [],
    location: input.location || undefined,
    status: input.status || undefined,
    documentationUrl: input.documentationUrl || undefined,
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
