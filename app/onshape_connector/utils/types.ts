// Re-export Kanban types for convenience

export type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";

/**
 * Query parameters for the Onshape connector page. Onshape supplies them when
 * it loads the iframe; the route is meaningless without them.
 *
 * @example /onshape_connector?elementType=PARTSTUDIO&documentId={$documentId}&instanceType={$workspaceOrVersion}&instanceId={$workspaceOrVersionId}&elementId={$elementId}
 *
 * This lives here rather than next to the route so client components can import
 * it without dragging the route module into the browser bundle.
 */
export type PartsPageSearchParams = {
  documentId: string;
  instanceType: "w" | "v" | "m";
  instanceId: string;
  elementId: string;
  elementType: string;
};

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
