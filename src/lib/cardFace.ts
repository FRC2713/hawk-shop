/** What the board's compact card face shows, apart from title and image. */
import type { KanbanCardWithProcesses } from "~/lib/api/kanban";
import { cardMachineName, unlinkedMachineText } from "~/lib/cardMachine";
import { MATERIAL_UNKNOWN } from "~/lib/cardSnapshot";
import { plural } from "~/lib/plural";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import type { UserRow } from "~/server/db/types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Time since the card entered its status: "40 min", "26 h", "3 d". */
export function timeInStatus(
  card: Pick<KanbanCardWithProcesses, "date_updated">,
  now: number
) {
  const since = new Date(card.date_updated).getTime();
  if (isNaN(since)) return null;
  const elapsed = Math.max(0, now - since);
  if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / MINUTE))} min`;
  if (elapsed < 2 * DAY) return `${Math.floor(elapsed / HOUR)} h`;
  return `${Math.floor(elapsed / DAY)} d`;
}

/**
 * The machine or "any <process>", assignee and time in status, then the
 * material. Material is last because it is long and the card truncates the
 * line; what a student acts on comes first.
 */
export function cardMetaLine(
  card: KanbanCardWithProcesses,
  usersMap: ReadonlyMap<string, UserRow>,
  now: number
) {
  const material = card.onshape_material?.trim();
  const machine =
    cardMachineName(card) ??
    unlinkedMachineText(card) ??
    (card.processes?.length ? `any ${card.processes[0].name}` : null);
  const assignee = card.assignee
    ? (usersMap.get(card.assignee)?.name ?? null)
    : null;
  return [
    machine,
    assignee,
    timeInStatus(card, now),
    material && material !== MATERIAL_UNKNOWN ? material : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Which problem a flag reports; each kind has its own icon on the card. */
export type CardFlagKind = "warning" | "sent-back" | "review-wait";

export interface CardFlag {
  label: string;
  kind: CardFlagKind;
}

/**
 * Problems worth a flag: release warnings, a send-back in the last week, or
 * over a day waiting in Review. Cards without a problem get none.
 */
export function cardFlags(
  card: KanbanCardWithProcesses,
  now: number
): CardFlag[] {
  const flags: CardFlag[] = [];
  const warnings = card.release_issues?.length ?? 0;
  if (warnings)
    flags.push({ label: plural(warnings, "warning"), kind: "warning" });
  const sentBack = (card.review_notes ?? []).filter(
    (note) => now - new Date(note.created_at).getTime() < 7 * DAY
  ).length;
  if (sentBack)
    flags.push({
      label: sentBack === 1 ? "Sent back once" : `Sent back ${sentBack} times`,
      kind: "sent-back",
    });
  if (
    card.column_id === WORKFLOW_COLUMN_IDS.review &&
    now - new Date(card.date_updated).getTime() > DAY
  )
    flags.push({ label: "Over a day in review", kind: "review-wait" });
  return flags;
}
