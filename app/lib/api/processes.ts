import { queryOptions } from "@tanstack/react-query";
import type { ProcessRow } from "~/lib/db/types";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

export interface ProcessInput {
  name: string;
  description?: string;
}

/**
 * Six components render the process list; all of them wanted the same five
 * minutes of staleness, so it lives here instead of in each `useQuery`.
 */
export function processesQuery() {
  return queryOptions({
    queryKey: queryKeys.processes.all(),
    queryFn: async () => {
      const { processes } = await apiFetch<{ processes: ProcessRow[] }>(
        "/api/processes",
        { fallbackError: "Failed to fetch processes" }
      );
      return processes;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export async function createProcess(input: ProcessInput): Promise<ProcessRow> {
  const { process } = await apiFetch<{ process: ProcessRow }>(
    "/api/processes",
    {
      method: "POST",
      json: {
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
      },
      fallbackError: "Failed to create process",
    }
  );
  return process;
}

export async function updateProcess(
  id: string,
  input: ProcessInput
): Promise<ProcessRow> {
  const { process } = await apiFetch<{ process: ProcessRow }>(
    `/api/processes/${id}`,
    {
      method: "PUT",
      json: {
        name: input.name.trim(),
        // Explicit null, not undefined: this is how the description is cleared.
        description: input.description?.trim() || null,
      },
      fallbackError: "Failed to update process",
    }
  );
  return process;
}

export async function deleteProcess(id: string): Promise<void> {
  await apiFetch(`/api/processes/${id}`, {
    method: "DELETE",
    fallbackError: "Failed to delete process",
  });
}
