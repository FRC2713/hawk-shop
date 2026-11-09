import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { KanbanColumn } from "~/server/kanbanApi/columnTypes";

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
  email: text("email"),
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
    // The part's microversion when it was released (or last seen by a
    // workspace parts read). Thumbnails are cached under it.
    onshape_microversion_id: text("onshape_microversion_id"),
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
 * from.
 *
 * Rows with a `microversion_id` are keyed by the real part
 * (`document_id`, `instance_type = "m"`, `instance_id` = microversion,
 * `element_id`, `part_id`) and are looked up by that. Legacy rows from before
 * microversion keys have a null `microversion_id`, a synthetic key, and are
 * looked up by `source_url`.
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
    microversion_id: text("microversion_id"),
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
 * Server-side cache of Onshape API responses.
 *
 * Onshape bills an **annual, company-wide** API allocation (a team on EDU
 * Enterprise gets 10,000 calls for the whole year, flat), so the scarce
 * resource is the call itself, not latency. Two students opening the same Part
 * Studio used to cost two calls; with this table it costs one.
 *
 * It lives in SQLite rather than memory on purpose — a container restart during
 * build season must not re-buy every response the team already paid for.
 *
 * `expires_at` is null for entries that can never go stale: a version or
 * microversion is frozen in Onshape, so parts fetched at `wvm=v` are immutable
 * for as long as the version exists.
 */
export const onshapeApiCache = sqliteTable(
  "onshape_api_cache",
  {
    cache_key: text("cache_key").primaryKey(),
    payload: text("payload").notNull(),
    created_at: text("created_at").notNull().$defaultFn(now),
    expires_at: text("expires_at"),
  },
  (table) => [index("idx_onshape_api_cache_expires_at").on(table.expires_at)]
);

/**
 * Per-day tally of Onshape calls actually issued vs. served from cache.
 *
 * Onshape's own usage page reports one number for the year with no endpoint
 * breakdown, which is not enough to find out what is spending the allocation.
 * `calls` counts requests that left the building; `hits` counts the ones this
 * cache absorbed.
 */
export const onshapeApiUsage = sqliteTable(
  "onshape_api_usage",
  {
    day: text("day").notNull(),
    label: text("label").notNull(),
    calls: integer("calls").notNull().default(0),
    hits: integer("hits").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.day, table.label] })]
);

/**
 * Latest `x-rate-limit-remaining` value Onshape sent, one row per endpoint
 * family (`label`, derived from the request path). Onshape appears to keep a
 * separate bucket per endpoint, so a single global number would mislead.
 * `remaining` is null when only a 402 without the header has been seen.
 */
export const onshapeApiRemaining = sqliteTable("onshape_api_remaining", {
  label: text("label").primaryKey(),
  remaining: integer("remaining"),
  observed_at: text("observed_at").notNull(),
  last_status: integer("last_status").notNull(),
});

/**
 * One Onshape webhook per document whose workspace the app reads (see
 * `~/lib/onshapeApi/webhooks`). `webhook_id` is Onshape's id. A re-check that
 * finds the webhook gone registers it again and replaces the id.
 */
export const onshapeWebhooks = sqliteTable("onshape_webhooks", {
  document_id: text("document_id").primaryKey(),
  webhook_id: text("webhook_id").notNull(),
  registered_at: text("registered_at").notNull(),
  last_event_at: text("last_event_at"),
  last_checked_at: text("last_checked_at"),
});

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

export { DEFAULT_KANBAN_COLUMNS } from "~/server/kanbanApi/columnTypes";

export const slackConfig = sqliteTable("slack_config", {
  reports_enabled: integer("reports_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  reports_channel_id: text("reports_channel_id"),
  id: text("id").primaryKey(),
  channel_id: text("channel_id"),
  channel_name: text("channel_name"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  generation: integer("generation").notNull().default(0),
  updated_at: text("updated_at").notNull().$defaultFn(now),
});

// Pending snapshots intentionally have no card foreign key: deletion must not
// erase a status change that was already committed.
export const slackPending = sqliteTable("slack_pending", {
  delivery_group: integer("delivery_group"),
  id: integer("id").primaryKey({ autoIncrement: true }),
  card_id: text("card_id").notNull(),
  submitter_id: text("submitter_id"),
  submitter_name: text("submitter_name").notNull(),
  submitter_email: text("submitter_email"),
  old_column_id: text("old_column_id").notNull(),
  new_column_id: text("new_column_id").notNull(),
  old_status: text("old_status").notNull(),
  new_status: text("new_status").notNull(),
  title: text("title").notNull(),
  quantity_to_make: integer("quantity_to_make"),
  channel_id: text("channel_id").notNull(),
  generation: integer("generation").notNull(),
  created_at: text("created_at").notNull(),
  expires_at: text("expires_at").notNull(),
  next_attempt_at: text("next_attempt_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  error_code: text("error_code"),
});

// Shared by administrator test posts and automatic delivery; survives restart.
export const slackPostGate = sqliteTable("slack_post_gate", {
  id: text("id").primaryKey(),
  next_post_at: text("next_post_at").notNull(),
});

// Receipts also enforce the per-member limit after successful delivery.
export const problemReports = sqliteTable(
  "problem_reports",
  {
    id: text("id").primaryKey(),
    member_id: text("member_id").notNull(),
    channel_id: text("channel_id").notNull(),
    text: text("text").notNull(),
    created_at: text("created_at").notNull(),
    expires_at: text("expires_at").notNull(),
    next_attempt_at: text("next_attempt_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    error_code: text("error_code"),
    delivered_at: text("delivered_at"),
  },
  (table) => [
    index("problem_reports_member_created").on(
      table.member_id,
      table.created_at
    ),
  ]
);
