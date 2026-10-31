import "@tanstack/react-start/server-only";
import { SlackError, slackCall, slackEnvironment } from "./client";
export type SlackChannel = {
  id: string;
  name: string;
  is_member?: boolean;
  is_archived?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  context_team_id?: string;
};
function usable(channel: SlackChannel) {
  return (
    /^[CG][A-Z0-9]+$/.test(channel.id) &&
    typeof channel.name === "string" &&
    channel.is_member === true &&
    channel.is_archived === false &&
    !channel.is_im &&
    !channel.is_mpim &&
    (channel.is_channel === true || channel.is_group === true) &&
    (!channel.context_team_id ||
      channel.context_team_id === slackEnvironment().workspace)
  );
}
export async function validateSlackChannel(id: string) {
  if (!/^[CG][A-Z0-9]+$/.test(id)) throw new SlackError("channel_not_found");
  const { channel } = await slackCall<{ channel: SlackChannel }>(
    "conversations.info",
    { channel: id }
  );
  if (!channel || channel.id !== id || !usable(channel))
    throw new SlackError(
      channel?.is_archived ? "is_archived" : "not_in_channel"
    );
  return { id: channel.id, name: channel.name };
}
export async function listSlackChannels() {
  const channels: Array<{ id: string; name: string }> = [];
  let cursor = "";
  const seen = new Set<string>();
  const deadline = Date.now() + 30000;
  let pages = 0;
  do {
    if (++pages > 100 || Date.now() >= deadline)
      throw new SlackError("unavailable");
    const page = await slackCall<{
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>(
      "conversations.list",
      {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor,
      },
      Math.min(10000, deadline - Date.now())
    );
    if (!Array.isArray(page.channels)) throw new SlackError("unavailable");
    channels.push(
      ...page.channels.filter(usable).map(({ id, name }) => ({ id, name }))
    );
    cursor = page.response_metadata?.next_cursor?.trim() ?? "";
    if (cursor && seen.has(cursor)) throw new SlackError("unavailable");
    seen.add(cursor);
  } while (cursor);
  return channels.sort((a, b) => a.name.localeCompare(b.name));
}
