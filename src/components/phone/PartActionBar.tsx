import type { KanbanCardWithProcesses } from "~/lib/api";

/**
 * The action for a part's current status (Claim, Done / Unclaim, Approve /
 * Send back), pinned at the bottom of the part page and shown under the
 * current part on Next up. #131 fills it in; until then it renders nothing
 * and the part page's footer stays empty.
 *
 * `viewerId` is the signed-in member's Suite subject, so the bar can tell
 * "your part" from someone else's.
 */
export function PartActionBar(_props: {
  card: KanbanCardWithProcesses;
  viewerId: string;
}) {
  return null;
}
