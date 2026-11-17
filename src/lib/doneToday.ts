/**
 * The board's Done column shows only parts finished today, in the browser's
 * local time; older ones are on /kanban/done. A card's `date_updated` changes
 * only when its status does, so it is the time the part reached Done.
 */

/** The column title for Done on the board. */
export const DONE_TODAY_TITLE = "Done today";

/** True when the card entered its current status on `now`'s local day. */
export function isDoneToday(
  card: { date_updated: string },
  now: Date = new Date()
): boolean {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return new Date(card.date_updated).getTime() >= midnight.getTime();
}

/** Split Done cards into today's and a count of the older ones. */
export function splitDoneToday<T extends { date_updated: string }>(
  cards: T[],
  now: Date = new Date()
): { today: T[]; olderCount: number } {
  const today = cards.filter((card) => isDoneToday(card, now));
  return { today, olderCount: cards.length - today.length };
}
