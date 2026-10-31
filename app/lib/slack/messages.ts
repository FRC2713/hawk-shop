import "@tanstack/react-start/server-only";
import { SlackError, slackCall, slackCooldown, deferSlackCall } from "./client";

const state = globalThis as typeof globalThis & {
  __hawkSlackPostState?: { posting: boolean };
};
const postState = (state.__hawkSlackPostState ??= { posting: false });
// The worker and test route share this gate. The worker persists retry deadlines.
export async function postSlackMessage(channel: string, text: string) {
  const nextPostAt = Math.max(
    slackCooldown("post_spacing"),
    slackCooldown("method:chat.postMessage")
  );
  if (postState.posting || Date.now() < nextPostAt)
    throw new SlackError(
      "ratelimited",
      Math.max(1, Math.ceil((nextPostAt - Date.now()) / 1000))
    );
  postState.posting = true;
  try {
    deferSlackCall("post_spacing", Date.now() + 1000);
    const result = await slackCall<{ channel?: string; ts?: string }>(
      "chat.postMessage",
      {
        channel,
        text,
        parse: "none",
        unfurl_links: false,
        unfurl_media: false,
      }
    );
    if (
      result.channel !== channel ||
      typeof result.ts !== "string" ||
      !result.ts
    )
      throw new SlackError("unavailable");
    return { channel: result.channel, ts: result.ts };
  } catch (error) {
    if (error instanceof SlackError && error.retryAfterSeconds)
      deferSlackCall(
        "post_spacing",
        Date.now() + error.retryAfterSeconds * 1000
      );
    throw error;
  } finally {
    postState.posting = false;
  }
}
