import "virtual:hawk-shop/server-only";

import { addCardRoster } from "~/server/stationRoster";
import { eq, inArray } from "drizzle-orm";
import { actorName, type SessionActor } from "~/lib/sessionActor";
import { db } from "~/server/db/client";
import { kanbanCards, reviewNotes, users } from "~/server/db/schema";
import type { KanbanCardWithProcesses } from "~/server/db/types";
import { getCards, updateCard } from "~/server/kanbanApi/cards";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";
import { getKanbanColumns } from "~/server/kanbanApi/config";
import { publishKanbanEvent } from "~/server/events/bus";
import { requireMachineCanTake } from "~/server/kanbanApi/machines";
import { getMachineQueue } from "~/server/kanbanApi/queues";
import {
  CardNotFoundError,
  InvalidWorkflowInputError,
  WorkflowConflictError,
} from "~/server/kanbanApi/workflowErrors";

/**
 * Shop workflow actions: one function per action, each taking the card id(s),
 * the actor and the action's own input. Every change goes through `updateCard`,
 * so status history, Slack status notifications and live updates behave
 * exactly as a column move does. Errors are the `workflowErrors` classes;
 * routes answer them with `workflowErrorResponse`.
 */

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

async function readCard(id: string): Promise<KanbanCardWithProcesses> {
  const [card] = await readCards([id]);
  return card;
}

async function statusTitle(columnId: string) {
  const columns = await getKanbanColumns();
  return columns.find((column) => column.id === columnId)?.title ?? columnId;
}

export class WrongStatusError extends WorkflowConflictError {
  readonly code = "wrong_status";
  constructor(cardIds: string[], message: string) {
    super(message, cardIds);
  }
}

/**
 * Assign Backlog cards to a machine, or with `machineId: null` return them to
 * their process queue. All or nothing: every card is checked before any
 * changes.
 */
export async function assignMachine(
  cardIds: string[],
  actor: SessionActor,
  { machineId }: { machineId: string | null }
): Promise<KanbanCardWithProcesses[]> {
  const ids = requireCards(cardIds);
  if (machineId !== null && (typeof machineId !== "string" || !machineId))
    throw new InvalidWorkflowInputError("Choose a machine or none");
  const backlogTitle = await statusTitle(WORKFLOW_COLUMN_IDS.backlog);
  const rows = db
    .select({ id: kanbanCards.id, column_id: kanbanCards.column_id })
    .from(kanbanCards)
    .where(inArray(kanbanCards.id, ids))
    .all();
  const started = rows.filter(
    (row) => row.column_id !== WORKFLOW_COLUMN_IDS.backlog
  );
  if (started.length === 1)
    throw new WrongStatusError(
      [started[0].id],
      `This part is in ${await statusTitle(started[0].column_id)}, so it can't be assigned a machine`
    );
  if (started.length > 1)
    throw new WrongStatusError(
      started.map((row) => row.id),
      `${started.length} of these parts aren't in ${backlogTitle}, so they can't be assigned a machine`
    );
  if (machineId !== null) requireMachineCanTake(db, machineId, ids);
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
 * that order. The machine's own parts left out return to the default order;
 * an empty list resets them all. Positions belong to the card, so a waiting
 * part keeps its place in other machines' queues too, and a waiting part left
 * out keeps the place another machine's mentor gave it. Not a status change:
 * no history or Slack notification, only live updates for the cards that
 * moved.
 */
export async function reorderMachineQueue(
  machineId: string,
  { cardIds }: { cardIds: string[] }
): Promise<Awaited<ReturnType<typeof getMachineQueue>>> {
  if (typeof machineId !== "string" || !machineId)
    throw new InvalidWorkflowInputError("Choose a machine");
  if (!Array.isArray(cardIds))
    throw new InvalidWorkflowInputError("List the parts in order");
  const ids = cardIds.length ? requireCards(cardIds) : [];
  const queue = await getMachineQueue(machineId);
  const queued = new Set(queue.cards.map((card) => card.id));
  const outside = ids.filter((id) => !queued.has(id));
  if (outside.length)
    throw new CardNotInQueueError(queue.machine.name, outside);
  const positions = new Map(ids.map((id, index) => [id, index]));
  const moved = queue.cards
    .filter((card) => positions.has(card.id) || card.machine_id === machineId)
    .filter((card) => (positions.get(card.id) ?? null) !== card.queue_position);
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
    throw new WrongStatusError(
      [cardId],
      `This part is in ${status}, so it can't be ${action}`
    );
  }
  return card;
}

/**
 * Claim a part: `userId` (default: the actor) becomes its assignee, and a
 * Backlog part moves to In Progress. `machineId` links a process-queue part to
 * the machine it is claimed at, which must be able to take it. Claiming a part
 * you already hold is a no-op; claiming someone else's is an
 * `AlreadyClaimedError`.
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
  if (machineId !== undefined) {
    if (!linkMachine && machineId !== card.machine_id)
      throw new OtherMachineError(card.id);
    // A station URL can outlive maintenance or process changes, including
    // for a part already assigned here. Preserve retries of an existing claim.
    if (
      card.column_id === WORKFLOW_COLUMN_IDS.backlog ||
      card.assignee !== userId
    )
      requireMachineCanTake(db, machineId, [card.id]);
  }
  await updateCard(
    card.id,
    {
      assignee: userId,
      column_id: WORKFLOW_COLUMN_IDS.inProgress,
      ...(linkMachine ? { machine_id: machineId } : {}),
    },
    {
      onshape_user_id: userId,
      email: null,
      name: actorName({ onshape_user_id: userId, email: null }),
    },
    (tx, updated) => addCardRoster(tx, updated, userId),
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

/** Mark done: an In Progress part goes to Review. */
export async function markDone(
  cardId: string,
  actor: SessionActor
): Promise<KanbanCardWithProcesses> {
  const card = await requireCardIn(
    cardId,
    [WORKFLOW_COLUMN_IDS.inProgress],
    "marked done"
  );
  await updateCard(
    card.id,
    { column_id: WORKFLOW_COLUMN_IDS.review },
    actor,
    (tx, updated) => addCardRoster(tx, updated, actor.onshape_user_id)
  );
  return readCard(card.id);
}

/** Approve: a Review part goes to Done. */
export async function approve(
  cardId: string,
  actor: SessionActor
): Promise<KanbanCardWithProcesses> {
  const card = await requireCardIn(
    cardId,
    [WORKFLOW_COLUMN_IDS.review],
    "approved"
  );
  await updateCard(card.id, { column_id: WORKFLOW_COLUMN_IDS.done }, actor);
  return readCard(card.id);
}

/**
 * Send back: a Review part returns to In Progress when it still has an
 * assignee, otherwise to Backlog. The required `reason` is kept as a review
 * note on the card for the assignee and submitter, written in the same
 * transaction as the move.
 */
export async function sendBack(
  cardId: string,
  actor: SessionActor,
  { reason }: { reason?: unknown } = {}
): Promise<KanbanCardWithProcesses> {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text)
    throw new InvalidWorkflowInputError("Say why this part is going back");
  const card = await requireCardIn(
    cardId,
    [WORKFLOW_COLUMN_IDS.review],
    "sent back"
  );
  await updateCard(
    card.id,
    {
      column_id: card.assignee
        ? WORKFLOW_COLUMN_IDS.inProgress
        : WORKFLOW_COLUMN_IDS.backlog,
    },
    actor,
    (tx) =>
      tx
        .insert(reviewNotes)
        .values({
          card_id: card.id,
          author_id: actor.onshape_user_id,
          author_name: actorName(actor, tx),
          text,
        })
        .run()
  );
  return readCard(card.id);
}
