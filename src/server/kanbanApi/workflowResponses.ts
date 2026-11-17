import "virtual:hawk-shop/server-only";

import { logServerError } from "~/server/errors";
import {
  InvalidNotesError,
  UnknownProjectError,
} from "~/server/kanbanApi/cards";
import {
  CardNotFoundError,
  InvalidWorkflowInputError,
  MachineNotFoundError,
  WorkflowConflictError,
} from "~/server/kanbanApi/workflowErrors";

/**
 * The response for an error a card edit or workflow action throws on
 * purpose, or null for anything else. Conflicts carry `code` and `cardIds`.
 */
export function knownErrorResponse(error: unknown): Response | null {
  if (error instanceof WorkflowConflictError)
    return Response.json(
      { error: error.message, code: error.code, cardIds: error.cardIds },
      { status: 409 }
    );
  if (error instanceof CardNotFoundError)
    return Response.json(
      { error: error.message, cardIds: error.cardIds },
      { status: 404 }
    );
  if (
    error instanceof InvalidWorkflowInputError ||
    error instanceof MachineNotFoundError ||
    error instanceof UnknownProjectError ||
    error instanceof InvalidNotesError
  )
    return Response.json({ error: error.message }, { status: 400 });
  return null;
}

/** Answers a workflow action's error; anything unexpected is logged as a 500. */
export function workflowErrorResponse(scope: string, error: unknown) {
  return (
    knownErrorResponse(error) ??
    Response.json(
      { error: "Something went wrong", errorId: logServerError(scope, error) },
      { status: 500 }
    )
  );
}
