/**
 * Row / Insert / Update types for the tables the app reads, inferred from the Drizzle schema.
 *
 * These names and shapes are the contract the UI is written against. Because the
 * schema declares snake_case TypeScript properties, `$inferSelect` already
 * produces exactly the row shape components expect — nothing is hand-maintained
 * here beyond the aliases.
 */

import type * as schema from "./schema";
import type {
  equipment,
  kanbanCards,
  processes,
  projects,
  users,
} from "./schema";

export type StatusHistoryRow = typeof schema.statusHistory.$inferSelect;

export type KanbanCardRow = typeof kanbanCards.$inferSelect;

export type UserRow = typeof users.$inferSelect;

export type EquipmentRow = typeof equipment.$inferSelect;

export type ProcessRow = typeof processes.$inferSelect;
export type ProcessInsert = typeof processes.$inferInsert;
export type ProcessUpdate = Partial<ProcessInsert>;

export type ProjectRow = typeof projects.$inferSelect;

/** A project as the projects API returns it. */
export type ProjectWithUsage = ProjectRow & {
  card_count: number;
  /** When the requesting member last released a part into it, or null. */
  last_used_by_me_at: string | null;
};

/** The part of a project the board shows on each card. */
export type CardProject = Pick<ProjectRow, "id" | "name" | "archived_at">;

/** A card as returned by the cards API — processes and project are joined in. */
export type KanbanCardWithProcesses = KanbanCardRow & {
  processes: ProcessRow[];
  project: CardProject | null;
};

/** Equipment as returned by the equipment API — processes are joined in. */
export type EquipmentWithProcesses = EquipmentRow & {
  processes: ProcessRow[];
};
