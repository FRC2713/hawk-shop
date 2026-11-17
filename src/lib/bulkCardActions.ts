/**
 * Rules for the board's bulk actions on selected cards: which machines to
 * offer, which cards an action skips, and how a partial failure reads.
 * Pure and client-safe.
 */
import { machineRefusal } from "~/lib/machineQueue";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

type Processes = { processes?: ReadonlyArray<{ id: string; name: string }> };
export type BulkCard = Processes & {
  id: string;
  title: string;
  column_id: string;
};
export type BulkMachine = Processes & {
  id: string;
  name: string;
  status: string | null;
};

export interface BulkOutcome<C extends BulkCard> {
  changed: C[];
  failed: { card: C; reason: string }[];
}

/** Run `request` for every card, all at once, and sort out which failed. */
export async function forEachCard<C extends BulkCard>(
  cards: readonly C[],
  request: (card: C) => Promise<unknown>
): Promise<BulkOutcome<C>> {
  const results = await Promise.allSettled(cards.map(request));
  const outcome: BulkOutcome<C> = { changed: [], failed: [] };
  results.forEach((result, index) => {
    if (result.status === "fulfilled") outcome.changed.push(cards[index]);
    else
      outcome.failed.push({
        card: cards[index],
        reason: errorReason(result.reason),
      });
  });
  return outcome;
}

export function errorReason(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Unknown error";
}

const NOT_IN_BACKLOG = "not in Backlog";

/**
 * The machines worth offering for `cards`: those that can take at least one
 * selected Backlog card. Only Backlog cards can be assigned, and a machine
 * under maintenance takes nothing.
 */
export function eligibleMachines<M extends BulkMachine>(
  machines: readonly M[],
  cards: readonly BulkCard[]
): M[] {
  const backlog = cards.filter(isBacklog);
  return machines.filter((machine) =>
    backlog.some((card) => machineRefusal(machine, card) === null)
  );
}

/**
 * Which cards to send to the bulk assign endpoint for `machine` (null clears
 * the machine), and why the rest are skipped.
 */
export function machineAssignment<C extends BulkCard>(
  machine: BulkMachine | null,
  cards: readonly C[]
): { send: C[]; skipped: { card: C; reason: string }[] } {
  const send: C[] = [];
  const skipped: { card: C; reason: string }[] = [];
  for (const card of cards) {
    if (!isBacklog(card)) {
      skipped.push({ card, reason: NOT_IN_BACKLOG });
      continue;
    }
    const refusal = machine && machineRefusal(machine, card);
    if (!machine || !refusal) send.push(card);
    else
      skipped.push({
        card,
        reason:
          refusal === "machine_needs_maintenance"
            ? `${machine.name} needs maintenance`
            : `${machine.name} doesn't do ${processNames(card)}`,
      });
  }
  return { send, skipped };
}

function isBacklog(card: { column_id: string }) {
  return card.column_id === WORKFLOW_COLUMN_IDS.backlog;
}

function processNames(card: Processes) {
  return (card.processes ?? []).map((process) => process.name).join(" or ");
}

/** "3 cards" / "1 card". */
export function cardCount(count: number) {
  return `${count} card${count === 1 ? "" : "s"}`;
}
