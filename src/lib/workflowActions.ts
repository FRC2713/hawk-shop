import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

export type WorkflowAction =
  "claim" | "unclaim" | "done" | "approve" | "sendBack";

/**
 * The workflow actions a part's status allows, in display order (the primary
 * action last). Mirrors the server's rules in `kanbanApi/workflow.ts`:
 * claim and unclaim from Backlog or In Progress, done from In Progress,
 * approve and send back from Review. A part in Done or a custom column has
 * none.
 */
export function workflowActionsFor(card: {
  column_id: string;
  assignee: string | null;
}): WorkflowAction[] {
  switch (card.column_id) {
    case WORKFLOW_COLUMN_IDS.backlog:
      return card.assignee ? ["unclaim"] : ["claim"];
    case WORKFLOW_COLUMN_IDS.inProgress:
      return card.assignee ? ["unclaim", "done"] : ["claim", "done"];
    case WORKFLOW_COLUMN_IDS.review:
      return ["sendBack", "approve"];
    default:
      return [];
  }
}
