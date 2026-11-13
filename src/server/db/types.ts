/**
 * Row / Insert / Update types for every table, inferred from the Drizzle schema.
 *
 * These names and shapes are the contract the UI is written against. Because the
 * schema declares snake_case TypeScript properties, `$inferSelect` already
 * produces exactly the row shape components expect — nothing is hand-maintained
 * here beyond the aliases.
 */

import type * as schema from "./schema";
import type {
  equipment,
  equipmentProcesses,
  kanbanCardProcesses,
  kanbanCards,
  kanbanConfig,
  partThumbnails,
  processes,
  projects,
  users,
} from "./schema";

export type { KanbanColumnConfig } from "./schema";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type StatusHistoryRow = typeof schema.statusHistory.$inferSelect;

export type KanbanCardRow = typeof kanbanCards.$inferSelect;
export type KanbanCardInsert = typeof kanbanCards.$inferInsert;
export type KanbanCardUpdate = Partial<KanbanCardInsert>;

export type KanbanConfigRow = typeof kanbanConfig.$inferSelect;
export type KanbanConfigInsert = typeof kanbanConfig.$inferInsert;

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type UserUpdate = Partial<UserInsert>;

export type EquipmentRow = typeof equipment.$inferSelect;
export type EquipmentInsert = typeof equipment.$inferInsert;
export type EquipmentUpdate = Partial<EquipmentInsert>;

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

export type EquipmentProcessRow = typeof equipmentProcesses.$inferSelect;
export type EquipmentProcessInsert = typeof equipmentProcesses.$inferInsert;

export type KanbanCardProcessRow = typeof kanbanCardProcesses.$inferSelect;
export type KanbanCardProcessInsert = typeof kanbanCardProcesses.$inferInsert;

export type PartThumbnailRow = typeof partThumbnails.$inferSelect;
export type PartThumbnailInsert = typeof partThumbnails.$inferInsert;
export type PartThumbnailUpdate = Partial<PartThumbnailInsert>;

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

export type Schema = typeof schema;
