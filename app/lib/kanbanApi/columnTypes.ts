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

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: "backlog", title: "Backlog", position: 0 },
  { id: "in-progress", title: "In Progress", position: 1 },
  { id: "review", title: "Review", position: 2 },
  { id: "done", title: "Done", position: 3 },
];
