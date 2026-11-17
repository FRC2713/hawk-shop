import "virtual:hawk-shop/server-only";

import { eq, inArray } from "drizzle-orm";
import type { SessionActor } from "~/lib/sessionActor";
import { db } from "~/server/db/client";
import {
  equipment,
  equipmentProcesses,
  kanbanCardProcesses,
  kanbanCards,
  users,
} from "~/server/db/schema";
import type { KanbanCardWithProcesses } from "~/server/db/types";
import {
  getCards,
  UnknownMachineError,
  updateCard,
} from "~/server/kanbanApi/cards";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { getKanbanColumns } from "~/server/kanbanApi/config";
import { publishKanbanEvent } from "~/server/events/bus";
import {
  getMachineQueue,
  MachineNotFoundError,
} from "~/server/kanbanApi/queues";

/**
 * Shop workflow actions: one function per action, each taking the card id(s),
 * the actor and the action's own input. Every change goes through `updateCard`,
 * so status history, Slack status notifications and live updates behave
 * exactly as a column move does.
 *
 * Errors: `InvalidWorkflowInputError` (400), `CardNotFoundError` (404),
 * `UnknownMachineError` from the cards module (400) and a
 * `WorkflowConflictError` subclass (409) when the action doesn't apply to the
 * card as it is now. Routes answer them with `workflowErrorResponse`.
 */

/** The request itself is malformed. */
export class InvalidWorkflowInputError extends Error {}

export class CardNotFoundError extends Error {
  constructor(readonly cardIds: string[]) {
    super(cardIds.length === 1 ? "Card not found" : "Cards not found");
  }
}

/**
 * The action doesn't apply to the card's current state. `code` is stable for
 * clients; `message` is shown to people.
 */
export abstract class WorkflowConflictError extends Error {
  abstract readonly code: string;
  constructor(
    message: string,
    readonly cardIds: string[] = []
  ) {
    super(message);
  }
}

function requireCards(cardIds: unknown): string[] {
  if (
    !Array.isArray(cardIds) ||
    cardIds.length === 0 ||
    !cardIds.every((id) => typeof id === "string" && id !== "")
  )
    throw new InvalidWorkflowInputError("Choose at least one card");
  const ids = [...new Set(cardIds as string[])];
  const found = new Set(
    db
      .select({ id: kanbanCards.id })
      .from(kanbanCards)
      .where(inArray(kanbanCards.id, ids))
      .all()
      .map((row) => row.id)
  );
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new CardNotFoundError(missing);
  return ids;
}

async function readCards(ids: string[]): Promise<KanbanCardWithProcesses[]> {
  const result = await getCards();
  if (result.error) throw new Error(result.error);
  const byId = new Map(result.cards.map((card) => [card.id, card]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export class MachineNeedsMaintenanceError extends WorkflowConflictError {
  readonly code = "machine_needs_maintenance";
  constructor(machine: string) {
    super(`${machine} needs maintenance and can't take parts`);
  }
}

export class MachineLacksProcessError extends WorkflowConflictError {
  readonly code = "machine_lacks_process";
  constructor(machine: string, cardIds: string[]) {
    super(
      `${machine} can't do the process ${cardIds.length === 1 ? "this part needs" : `${cardIds.length} of these parts need`}`,
      cardIds
    );
  }
}

/**
 * A machine takes a part when it isn't flagged for maintenance and shares at
 * least one of the part's processes (a part with no processes fits anywhere),
 * the same rule that puts a waiting part in a machine's queue.
 */
function requireMachineCanTake(machineId: string, cardIds: string[]) {
  const machine = db
    .select({ name: equipment.name, status: equipment.status })
    .from(equipment)
    .where(eq(equipment.id, machineId))
    .get();
  if (!machine) throw new UnknownMachineError();
  if (machine.status === "maintenance")
    throw new MachineNeedsMaintenanceError(machine.name);
  const machineProcesses = new Set(
    db
      .select({ id: equipmentProcesses.process_id })
      .from(equipmentProcesses)
      .where(eq(equipmentProcesses.equipment_id, machineId))
      .all()
      .map((row) => row.id)
  );
  const cardProcesses = new Map<string, string[]>();
  for (const row of db
    .select()
    .from(kanbanCardProcesses)
    .where(inArray(kanbanCardProcesses.card_id, cardIds))
    .all())
    cardProcesses.set(row.card_id, [
      ...(cardProcesses.get(row.card_id) ?? []),
      row.process_id,
    ]);
  const refused = cardIds.filter((id) => {
    const processes = cardProcesses.get(id) ?? [];
    return (
      processes.length > 0 && !processes.some((p) => machineProcesses.has(p))
    );
  });
  if (refused.length) throw new MachineLacksProcessError(machine.name, refused);
}

/**
 * Assign cards to a machine, or with `machineId: null` return them to their
 * process queue.
 */
export async function assignMachine(
  cardIds: string[],
  actor: SessionActor,
  { machineId }: { machineId: string | null }
): Promise<KanbanCardWithProcesses[]> {
  const ids = requireCards(cardIds);
  if (machineId !== null && (typeof machineId !== "string" || !machineId))
    throw new InvalidWorkflowInputError("Choose a machine or none");
  // Check every card before changing any, so a refused bulk assign changes
  // nothing.
  if (machineId !== null) requireMachineCanTake(machineId, ids);
  for (const id of ids) await updateCard(id, { machine_id: machineId }, actor);
  return readCards(ids);
}

export class CardNotInQueueError extends WorkflowConflictError {
  readonly code = "card_not_in_queue";
  constructor(machine: string, cardIds: string[]) {
    super(
      `${cardIds.length === 1 ? "A part isn't" : `${cardIds.length} parts aren't`} in ${machine}'s queue`,
      cardIds
    );
  }
}

/**
 * Put a machine's queue in a mentor's order: `cardIds` become its front, in
 * that order, and every other card in the queue returns to the default order.
 * An empty list resets the whole queue. Positions belong to the card, so a
 * waiting part keeps its place in other machines' queues too, and a machine's
 * own parts always stay ahead of waiting ones. Not a status change: no history
 * or Slack notification, only live updates for the cards that moved.
 */
export async function reorderMachineQueue(
  machineId: string,
  _actor: SessionActor,
  { cardIds }: { cardIds: string[] }
): Promise<Awaited<ReturnType<typeof getMachineQueue>>> {
  if (typeof machineId !== "string" || !machineId)
    throw new InvalidWorkflowInputError("Choose a machine");
  if (!Array.isArray(cardIds))
    throw new InvalidWorkflowInputError("List the parts in order");
  const ids = cardIds.length ? requireCards(cardIds) : [];
  const queue = await getMachineQueue(machineId).catch((error) => {
    throw error instanceof MachineNotFoundError
      ? new UnknownMachineError()
      : error;
  });
  const queued = new Set(queue.cards.map((card) => card.id));
  const outside = ids.filter((id) => !queued.has(id));
  if (outside.length)
    throw new CardNotInQueueError(queue.machine.name, outside);
  const positions = new Map(ids.map((id, index) => [id, index]));
  const moved = queue.cards.filter(
    (card) => (positions.get(card.id) ?? null) !== card.queue_position
  );
  db.transaction((tx) => {
    for (const card of moved)
      tx.update(kanbanCards)
        .set({ queue_position: positions.get(card.id) ?? null })
        .where(eq(kanbanCards.id, card.id))
        .run();
  });
  for (const card of moved)
    publishKanbanEvent({
      table: "kanban_cards",
      action: "update",
      id: card.id,
    });
  return getMachineQueue(machineId);
}

/** An assignee must be a member who has signed in at least once. */
function requireMember(userId: unknown): asserts userId is string {
  if (
    typeof userId !== "string" ||
    !userId ||
    !db
      .select({ id: users.onshape_user_id })
      .from(users)
      .where(eq(users.onshape_user_id, userId))
      .get()
  )
    throw new InvalidWorkflowInputError("Choose a member who has signed in");
}

export class WrongStatusError extends WorkflowConflictError {
  readonly code = "wrong_status";
  constructor(cardId: string, status: string, action: string) {
    super(`This part is in ${status}, so it can't be ${action}`, [cardId]);
  }
}

export class AlreadyClaimedError extends WorkflowConflictError {
  readonly code = "already_claimed";
  constructor(cardId: string) {
    super("Someone else already claimed this part", [cardId]);
  }
}

export class OtherMachineError extends WorkflowConflictError {
  readonly code = "other_machine";
  constructor(cardId: string) {
    super("This part is assigned to a different machine", [cardId]);
  }
}

export class NotClaimedError extends WorkflowConflictError {
  readonly code = "not_claimed";
  constructor(cardId: string) {
    super("Nobody has claimed this part", [cardId]);
  }
}

/**
 * Reads one card and checks it is in one of `statuses`, so a single-card
 * action can validate before it calls `updateCard`. Call it after any `await`
 * the action needs and call `updateCard` straight after the checks: with no
 * `await` in between, two concurrent actions can't both pass them.
 */
async function requireCardIn(
  cardId: unknown,
  statuses: string[],
  action: string
) {
  if (typeof cardId !== "string" || !cardId)
    throw new InvalidWorkflowInputError("Choose a card");
  const columns = await getKanbanColumns();
  const card = db
    .select()
    .from(kanbanCards)
    .where(eq(kanbanCards.id, cardId))
    .get();
  if (!card) throw new CardNotFoundError([cardId]);
  if (!statuses.includes(card.column_id)) {
    const status =
      columns.find((column) => column.id === card.column_id)?.title ??
      card.column_id;
    throw new WrongStatusError(cardId, status, action);
  }
  return card;
}

async function readCard(id: string): Promise<KanbanCardWithProcesses> {
  const [card] = await readCards([id]);
  return card;
}

/**
 * Claim a part: `userId` (default: the actor) becomes its assignee, and a
 * Backlog part moves to In Progress. `machineId` links a process-queue part to
 * the machine it is claimed at. Claiming a part you already hold is a no-op;
 * claiming someone else's is an `AlreadyClaimedError`.
 */
export async function claim(
  cardId: string,
  actor: SessionActor,
  {
    machineId,
    userId = actor.onshape_user_id,
  }: { machineId?: string; userId?: string } = {}
): Promise<KanbanCardWithProcesses> {
  if (machineId !== undefined && (typeof machineId !== "string" || !machineId))
    throw new InvalidWorkflowInputError("Choose a machine");
  const card = await requireCardIn(
    cardId,
    [WORKFLOW_COLUMN_IDS.backlog, WORKFLOW_COLUMN_IDS.inProgress],
    "claimed"
  );
  requireMember(userId);
  if (card.assignee && card.assignee !== userId)
    throw new AlreadyClaimedError(card.id);
  // A process-queue part takes the machine it is claimed at; a part already
  // on a machine can only be claimed there.
  const linkMachine = machineId !== undefined && card.machine_id === null;
  if (linkMachine) requireMachineCanTake(machineId, [card.id]);
  else if (machineId !== undefined && machineId !== card.machine_id)
    throw new OtherMachineError(card.id);
  await updateCard(
    card.id,
    {
      assignee: userId,
      column_id: WORKFLOW_COLUMN_IDS.inProgress,
      ...(linkMachine ? { machine_id: machineId } : {}),
    },
    actor
  );
  return readCard(card.id);
}

/**
 * Unclaim a part: clear its assignee and return it to Backlog, where it waits
 * in the same machine's (or process's) queue as before.
 */
export async function unclaim(
  cardId: string,
  actor: SessionActor
): Promise<KanbanCardWithProcesses> {
  const card = await requireCardIn(
    cardId,
    [WORKFLOW_COLUMN_IDS.backlog, WORKFLOW_COLUMN_IDS.inProgress],
    "unclaimed"
  );
  if (!card.assignee) throw new NotClaimedError(card.id);
  await updateCard(
    card.id,
    { assignee: null, column_id: WORKFLOW_COLUMN_IDS.backlog },
    actor
  );
  return readCard(card.id);
}
