/**
 * Runs one request per selected card for the board's bulk actions and sorts
 * out which cards changed and which failed, with the reason for each.
 */
import type { BulkCard } from "./bulkCardActions";

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
