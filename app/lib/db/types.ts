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

export type EquipmentProcessRow = typeof equipmentProcesses.$inferSelect;
export type EquipmentProcessInsert = typeof equipmentProcesses.$inferInsert;

export type KanbanCardProcessRow = typeof kanbanCardProcesses.$inferSelect;
export type KanbanCardProcessInsert = typeof kanbanCardProcesses.$inferInsert;

export type PartThumbnailRow = typeof partThumbnails.$inferSelect;
export type PartThumbnailInsert = typeof partThumbnails.$inferInsert;
export type PartThumbnailUpdate = Partial<PartThumbnailInsert>;

/** A card as returned by the cards API — processes are joined in. */
export type KanbanCardWithProcesses = KanbanCardRow & {
  processes: ProcessRow[];
};

/** Equipment as returned by the equipment API — processes are joined in. */
export type EquipmentWithProcesses = EquipmentRow & {
  processes: ProcessRow[];
};

export type Schema = typeof schema;
