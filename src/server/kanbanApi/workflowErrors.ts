/**
 * Errors shop workflow actions and card edits throw. Routes answer them with
 * `workflowErrorResponse`: `InvalidWorkflowInputError` and
 * `MachineNotFoundError` are 400, `CardNotFoundError` 404, and a
 * `WorkflowConflictError` subclass 409 when the action doesn't apply to the
 * card as it is now.
 */

/** The request itself is malformed. */
export class InvalidWorkflowInputError extends Error {}

export class CardNotFoundError extends Error {
  constructor(readonly cardIds: string[]) {
    super(cardIds.length === 1 ? "Card not found" : "Cards not found");
  }
}

/** A card or request names a machine that isn't an equipment record. */
export class MachineNotFoundError extends Error {
  constructor() {
    super("Machine not found");
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

export class MachineNeedsMaintenanceError extends WorkflowConflictError {
  readonly code = "machine_needs_maintenance";
  constructor(machine: string, cardIds: string[]) {
    super(`${machine} needs maintenance and can't take parts`, cardIds);
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
