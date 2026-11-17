import "virtual:hawk-shop/server-only";

import { logServerError } from "~/server/errors";
import { UnknownMachineError } from "~/server/kanbanApi/cards";
import {
  CardNotFoundError,
  InvalidWorkflowInputError,
  WorkflowConflictError,
} from "~/server/kanbanApi/workflow";

/** Answers a workflow action's error. Conflicts carry `code` and `cardIds`. */
export function workflowErrorResponse(scope: string, error: unknown) {
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
    error instanceof UnknownMachineError
  )
    return Response.json({ error: error.message }, { status: 400 });
  const errorId = logServerError(scope, error);
  return Response.json(
    { error: "Something went wrong", errorId },
    { status: 500 }
  );
}
