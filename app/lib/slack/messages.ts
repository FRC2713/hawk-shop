import "@tanstack/react-start/server-only";
import { SlackError, slackCall } from "./client";

let nextPostAt = 0;
let posting = false;
// The worker and test route share this gate. The worker persists retry deadlines.
export async function postSlackMessage(channel: string, text: string) {
  if (posting || Date.now() < nextPostAt)
    throw new SlackError(
      "ratelimited",
      Math.max(1, Math.ceil((nextPostAt - Date.now()) / 1000))
    );
  posting = true;
  nextPostAt = Date.now() + 1000;
  try {
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
      nextPostAt = Math.max(
        nextPostAt,
        Date.now() + error.retryAfterSeconds * 1000
      );
    throw error;
  } finally {
    posting = false;
  }
}
