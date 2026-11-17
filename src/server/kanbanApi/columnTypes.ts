/**
 * Column types shared by the board UI and the server.
 *
 * This module deliberately has no imports: client components need these types
 * and the default column list, and pulling them from a route handler or the
 * Drizzle schema would drag server-only code into the browser bundle.
 */

export interface KanbanColumn {
  id: string;
  title: string;
  position: number;
}

export interface KanbanConfig {
  columns: KanbanColumn[];
}

/**
 * The statuses shop workflow actions (claim, unclaim, done, approve, send
 * back) move cards between. Edit Columns may rename these columns but never
 * delete them.
 */
export const WORKFLOW_COLUMN_IDS = {
  backlog: "backlog",
  inProgress: "in-progress",
  review: "review",
  done: "done",
} as const;

export function isWorkflowColumn(id: string): boolean {
  return (Object.values(WORKFLOW_COLUMN_IDS) as string[]).includes(id);
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "backlog", title: "Backlog", position: 0 },
  { id: "in-progress", title: "In Progress", position: 1 },
  { id: "review", title: "Review", position: 2 },
  { id: "done", title: "Done", position: 3 },
];
