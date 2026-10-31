export type SlackSettings = {
  id: string;
  channel_id: string | null;
  channel_name: string | null;
  enabled: boolean;
  generation: number;
  updated_at: string;
};
export type SlackDestination = { id: string; name: string };
export type SlackDeliveryIssue = { code: string; action: string };
export type SlackStatus = {
  settings: SlackSettings;
  health: {
    state: "disabled" | "ready" | "pending" | "problem";
    issue: SlackDeliveryIssue | null;
  };
  pending_count: number;
  pending: Array<{
    id: number;
    card_id: string;
    title: string;
    submitter_name: string;
    old_status: string;
    new_status: string;
    created_at: string;
    expires_at: string;
    next_attempt_at: string;
    attempts: number;
    issue: SlackDeliveryIssue | null;
  }>;
};
