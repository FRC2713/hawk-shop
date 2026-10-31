export type SlackSettings = {
  id: string;
  channel_id: string | null;
  channel_name: string | null;
  enabled: boolean;
  generation: number;
  updated_at: string;
};
export type SlackDestination = { id: string; name: string };
