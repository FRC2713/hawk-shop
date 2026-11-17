import "virtual:hawk-shop/server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { MachineWeeklyStats } from "~/lib/equipment";
import { db } from "~/server/db/client";
import { kanbanCards, statusHistory } from "~/server/db/schema";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

/** Monday 00:00 UTC through next Monday, exclusive. Counts distinct cards per
 * outcome, using their current machine link. History has no machine snapshot:
 * reassigned cards follow their current machine; deleted cards are excluded.
 * One query for all machines, reusable by the list and machine page (#139).
 */
export async function getMachineWeeklyStats(now = new Date()): Promise<{
  week_start: string;
  week_end: string;
  by_machine: Map<string, MachineWeeklyStats>;
}> {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const week_start = start.toISOString();
  const week_end = end.toISOString();
  const rows = await db
    .select({
      machine_id: kanbanCards.machine_id,
      done: sql<number>`count(distinct case when ${statusHistory.to_column_id} = ${WORKFLOW_COLUMN_IDS.done} and ${statusHistory.from_column_id} is not null then ${statusHistory.card_id} end)`,
      sent_back: sql<number>`count(distinct case when ${statusHistory.from_column_id} = ${WORKFLOW_COLUMN_IDS.review} and ${statusHistory.to_column_id} in (${WORKFLOW_COLUMN_IDS.backlog}, ${WORKFLOW_COLUMN_IDS.inProgress}) then ${statusHistory.card_id} end)`,
    })
    .from(statusHistory)
    .innerJoin(kanbanCards, eq(kanbanCards.id, statusHistory.card_id))
    .where(
      and(
        gte(statusHistory.moved_at, week_start),
        lt(statusHistory.moved_at, week_end)
      )
    )
    .groupBy(kanbanCards.machine_id);
  return {
    week_start,
    week_end,
    by_machine: new Map(
      rows
        .filter((row) => row.machine_id !== null)
        .map((row) => [
          row.machine_id!,
          { done: row.done, sent_back: row.sent_back },
        ])
    ),
  };
}
