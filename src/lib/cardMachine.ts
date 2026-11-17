import type { CardMachine, KanbanCardRow } from "~/server/db/types";

type CardWithMachine = Pick<KanbanCardRow, "machine"> & {
  linked_machine?: CardMachine | null;
};

/** The linked machine's name, or null when the card has none. */
export function cardMachineName(card: CardWithMachine) {
  return card.linked_machine?.name ?? null;
}

/**
 * Machine text from before cards linked to equipment that matched no
 * equipment name, shown as unlinked until a mentor picks a machine. "TBD" was
 * every release's placeholder, so it says nothing.
 */
export function unlinkedMachineText(card: CardWithMachine) {
  if (card.linked_machine) return null;
  const text = card.machine?.trim();
  return text && text.toUpperCase() !== "TBD" ? text : null;
}
