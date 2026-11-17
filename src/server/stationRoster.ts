import "virtual:hawk-shop/server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, type Transaction } from "~/server/db/client";
import {
  equipmentProcesses,
  kanbanCardProcesses,
  processes,
  stationRoster,
  users,
} from "~/server/db/schema";
import { publishKanbanEvent } from "~/server/events/bus";
import { InvalidWorkflowInputError } from "~/server/kanbanApi/workflowErrors";

/** Use local calendar dates, rather than subtracting elapsed hours across DST. */
export function shopDay(now = new Date()) {
  const zone = process.env.SHOP_TIMEZONE || "America/New_York";
  const raw = process.env.SHOP_DAY_CUTOFF_HOUR || "3";
  const cutoff = Number(raw);
  if (!/^\d+$/.test(raw) || cutoff < 0 || cutoff > 23)
    throw new Error("SHOP_DAY_CUTOFF_HOUR must be an integer from 0 to 23");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (name: string) =>
    Number(parts.find((p) => p.type === name)!.value);
  return new Date(
    Date.UTC(
      value("year"),
      value("month") - 1,
      value("day") - (value("hour") < cutoff ? 1 : 0)
    )
  )
    .toISOString()
    .slice(0, 10);
}

function requireProcess(id: string) {
  if (!db.select().from(processes).where(eq(processes.id, id)).get())
    throw new InvalidWorkflowInputError("Choose a process");
}

export function requireRosterMember(id: unknown): asserts id is string {
  if (
    typeof id !== "string" ||
    !id ||
    !db.select().from(users).where(eq(users.onshape_user_id, id)).get()
  )
    throw new InvalidWorkflowInputError("Choose a member who has signed in");
}

export function listStationRoster(processId: string) {
  requireProcess(processId);
  const day = shopDay();
  const members = db
    .select({ onshape_user_id: users.onshape_user_id, name: users.name })
    .from(stationRoster)
    .innerJoin(users, eq(users.onshape_user_id, stationRoster.user_id))
    .where(
      and(
        eq(stationRoster.process_id, processId),
        eq(stationRoster.shop_day, day)
      )
    )
    .orderBy(asc(users.name), asc(users.onshape_user_id))
    .all();
  return { shop_day: day, members };
}

export function changeStationRoster(
  processId: string,
  userId: unknown,
  remove = false
) {
  requireProcess(processId);
  requireRosterMember(userId);
  const day = shopDay();
  if (remove)
    db.delete(stationRoster)
      .where(
        and(
          eq(stationRoster.process_id, processId),
          eq(stationRoster.shop_day, day),
          eq(stationRoster.user_id, userId)
        )
      )
      .run();
  else
    db.insert(stationRoster)
      .values({ process_id: processId, user_id: userId, shop_day: day })
      .onConflictDoNothing()
      .run();
  publishKanbanEvent({
    table: "station_roster",
    action: remove ? "delete" : "insert",
    id: processId,
  });
  return listStationRoster(processId);
}

/** Record activity in the same transaction as the successful workflow action. */
export function addCardRoster(
  tx: Transaction,
  card: { id: string; machine_id: string | null },
  userId: string
) {
  const cardProcesses = tx
    .select()
    .from(kanbanCardProcesses)
    .where(eq(kanbanCardProcesses.card_id, card.id))
    .all();
  const machineProcesses = card.machine_id
    ? new Set(
        tx
          .select()
          .from(equipmentProcesses)
          .where(eq(equipmentProcesses.equipment_id, card.machine_id))
          .all()
          .map((p) => p.process_id)
      )
    : null;
  const day = shopDay();
  for (const p of cardProcesses) {
    if (machineProcesses && !machineProcesses.has(p.process_id)) continue;
    tx.insert(stationRoster)
      .values({ process_id: p.process_id, user_id: userId, shop_day: day })
      .onConflictDoNothing()
      .run();
  }
}
