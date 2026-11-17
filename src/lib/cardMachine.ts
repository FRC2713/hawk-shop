import type { CardMachine, KanbanCardRow } from "~/server/db/types";

type CardWithMachine = Pick<KanbanCardRow, "machine"> & {
  linked_machine?: CardMachine | null;
};

/** The linked machine's name, or null when the card has none. */
export function cardMachineName(card: CardWithMachine) {
  return card.linked_machine?.name ?? null;
}

/**
 * Legacy free-text machine worth showing, or null. "TBD" was every release's
 * placeholder, so it says nothing.
 */
export function legacyMachineText(machine: string | null | undefined) {
  const text = machine?.trim();
  return text && text.toUpperCase() !== "TBD" ? text : null;
}

/**
 * Machine text from before cards linked to equipment that matched no
 * equipment name, shown as unlinked until a mentor picks a machine.
 */
export function unlinkedMachineText(card: CardWithMachine) {
  return card.linked_machine ? null : legacyMachineText(card.machine);
}
