import {
  approveCard,
  claimCard,
  markCardDone,
  sendCardBack,
  unclaimCard,
} from "~/lib/api/workflow";
import { WORKFLOW_COLUMN_IDS } from "~/server/kanbanApi/columnTypes";

type WorkflowCard = { column_id: string; assignee: string | null };

const { backlog, inProgress, review } = WORKFLOW_COLUMN_IDS;

/**
 * Every workflow action a part's details offer, in display order (claim or
 * unclaim first, the primary step last). `allowed` mirrors the server's
 * rules in `kanbanApi/workflow.ts`: claim and unclaim from Backlog or In
 * Progress, done from In Progress, approve and send back from Review. Only
 * send back uses `reason`.
 */
export const WORKFLOW_ACTIONS = {
  claim: {
    label: "Claim",
    primary: true,
    allowed: (card: WorkflowCard) =>
      !card.assignee &&
      (card.column_id === backlog || card.column_id === inProgress),
    request: (id: string) => claimCard(id),
  },
  unclaim: {
    label: "Unclaim",
    primary: false,
    allowed: (card: WorkflowCard) =>
      !!card.assignee &&
      (card.column_id === backlog || card.column_id === inProgress),
    request: (id: string) => unclaimCard(id),
  },
  sendBack: {
    label: "Send back",
    primary: false,
    allowed: (card: WorkflowCard) => card.column_id === review,
    request: (id: string, reason: string) => sendCardBack(id, reason),
  },
  done: {
    label: "Done, send to review",
    primary: true,
    allowed: (card: WorkflowCard) => card.column_id === inProgress,
    request: (id: string) => markCardDone(id),
  },
  approve: {
    label: "Approve",
    primary: true,
    allowed: (card: WorkflowCard) => card.column_id === review,
    request: (id: string) => approveCard(id),
  },
} satisfies Record<
  string,
  {
    label: string;
    primary: boolean;
    allowed: (card: WorkflowCard) => boolean;
    request: (id: string, reason: string) => Promise<unknown>;
  }
>;

export type WorkflowAction = keyof typeof WORKFLOW_ACTIONS;

/** The actions a part's status allows, in display order. */
export function workflowActionsFor(card: WorkflowCard): WorkflowAction[] {
  return (Object.keys(WORKFLOW_ACTIONS) as WorkflowAction[]).filter((action) =>
    WORKFLOW_ACTIONS[action].allowed(card)
  );
}
