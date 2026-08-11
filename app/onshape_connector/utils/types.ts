// Re-export Kanban types for convenience

export type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";

/**
 * Action response type
 */
export interface ActionResponse {
  success: boolean;
  error?: string;
  data?: unknown;
  redirect?: string;
  headers?: {
    "Set-Cookie": string;
  };
}
