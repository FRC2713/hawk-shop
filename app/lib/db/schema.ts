import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";

/**
 * Kanban column configuration stored as a JSON blob in `kanban_config`.
 * Columns are deliberately not a table — a card's `column_id` points at one of these ids.
 */
export type KanbanColumnConfig = KanbanColumn;

/**
 * All timestamps are ISO-8601 strings rather than SQLite integers, and every
 * column keeps its snake_case name as the TypeScript property too. That makes
 * Drizzle's inferred row types drop-in replacements for the hand-written
 * Supabase types the UI was built against — see ./types.ts.
 */
const now = () => new Date().toISOString();

export const users = sqliteTable("users", {
  onshape_user_id: text("onshape_user_id").primaryKey(),
  name: text("name"),
  created_at: text("created_at").notNull().$defaultFn(now),
  updated_at: text("updated_at").notNull().$defaultFn(now).$onUpdateFn(now),
});

export const processes = sqliteTable("processes", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  created_at: text("created_at").notNull().$defaultFn(now),
  updated_at: text("updated_at").notNull().$defaultFn(now).$onUpdateFn(now),
});

export const equipment = sqliteTable("equipment", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  location: text("location"),
  status: text("status"),
  documentation_url: text("documentation_url"),
  image_urls: text("image_urls", { mode: "json" }).$type<string[]>(),
  created_at: text("created_at").notNull().$defaultFn(now),
  updated_at: text("updated_at").notNull().$defaultFn(now).$onUpdateFn(now),
});

export const kanbanCards = sqliteTable(
  "kanban_cards",
  {
    id: text("id").primaryKey(),
    column_id: text("column_id").notNull(),
    title: text("title").notNull(),
    image_url: text("image_url"),
    assignee: text("assignee"),
    date_created: text("date_created").notNull().$defaultFn(now),
    date_updated: text("date_updated").notNull().$defaultFn(now),
    machine: text("machine"),
    due_date: text("due_date"),
    content: text("content"),
    created_by: text("created_by"),
    quantity_per_robot: integer("quantity_per_robot"),
    quantity_to_make: integer("quantity_to_make"),
    onshape_document_id: text("onshape_document_id"),
    onshape_instance_type: text("onshape_instance_type"),
    onshape_instance_id: text("onshape_instance_id"),
    onshape_element_id: text("onshape_element_id"),
    onshape_part_id: text("onshape_part_id"),
    onshape_version_id: text("onshape_version_id"),
  },
  (table) => [
    index("idx_kanban_cards_column_id").on(table.column_id),
    index("idx_kanban_cards_date_created").on(table.date_created),
  ]
);

export const kanbanConfig = sqliteTable("kanban_config", {
  id: text("id").primaryKey(),
  columns: text("columns", { mode: "json" })
    .$type<KanbanColumnConfig[]>()
    .notNull(),
});

export const equipmentProcesses = sqliteTable(
  "equipment_processes",
  {
    equipment_id: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    process_id: text("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.equipment_id, table.process_id] }),
    index("idx_equipment_processes_equipment_id").on(table.equipment_id),
    index("idx_equipment_processes_process_id").on(table.process_id),
  ]
);

export const kanbanCardProcesses = sqliteTable(
  "kanban_card_processes",
  {
    card_id: text("card_id")
      .notNull()
      .references(() => kanbanCards.id, { onDelete: "cascade" }),
    process_id: text("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.card_id, table.process_id] }),
    index("idx_kanban_card_processes_card_id").on(table.card_id),
    index("idx_kanban_card_processes_process_id").on(table.process_id),
  ]
);

/**
 * Cache of Onshape part thumbnails copied into local storage. `storage_path` is
 * relative to the uploads directory; `source_url` is the Onshape URL it came
 * from and is what cache lookups key on.
 */
export const partThumbnails = sqliteTable(
  "part_thumbnails",
  {
    document_id: text("document_id").notNull(),
    instance_type: text("instance_type").notNull(),
    instance_id: text("instance_id").notNull(),
    element_id: text("element_id").notNull(),
    part_id: text("part_id").notNull(),
    storage_path: text("storage_path").notNull(),
    source_url: text("source_url"),
    created_at: text("created_at").notNull().$defaultFn(now),
  },
  (table) => [
    primaryKey({
      columns: [
        table.document_id,
        table.instance_type,
        table.instance_id,
        table.element_id,
        table.part_id,
      ],
    }),
    index("idx_part_thumbnails_source_url").on(table.source_url),
  ]
);

/**
 * Processes seeded on first boot so a fresh self-hosted install is usable
 * immediately. Mirrors migration 007 of the Postgres-era schema.
 */
export const SEED_PROCESSES = [
  {
    id: "process-cnc-milling",
    name: "CNC Milling",
    description: "Computer numerical control milling operations",
  },
  {
    id: "process-3d-printing",
    name: "3D Printing",
    description: "Additive manufacturing using 3D printers",
  },
  {
    id: "process-hand-tooling",
    name: "Hand Tooling",
    description: "Manual operations using hand tools",
  },
  {
    id: "process-measuring",
    name: "Measuring",
    description: "Measurement and inspection operations",
  },
  {
    id: "process-power-tooling",
    name: "Power Tooling",
    description: "Operations using power tools",
  },
  {
    id: "process-safety-equipment",
    name: "Safety Equipment",
    description: "Safety-related processes and equipment",
  },
  {
    id: "process-fastening",
    name: "Fastening",
    description: "Assembly and fastening operations",
  },
  {
    id: "process-material-processing",
    name: "Material Processing",
    description: "Material preparation and processing",
  },
  {
    id: "process-other",
    name: "Other",
    description: "Other manufacturing processes",
  },
];

export { DEFAULT_KANBAN_COLUMNS } from "~/lib/kanbanApi/columnTypes";
