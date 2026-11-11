import "virtual:hawk-shop/server-only";
import { SlackError, slackCall } from "./client";

// Upload an image privately to Slack and return its file ID. Not shared to any
// channel: a release message shows it through an image block's slack_file.
// Slack's servers cannot reach Hawk Shop behind the Suite gateway, so an image
// URL would not load.
export async function uploadSlackImage(
  bytes: Buffer,
  filename: string,
  title: string
): Promise<string> {
  const { upload_url, file_id } = await slackCall<{
    upload_url?: string;
    file_id?: string;
  }>("files.getUploadURLExternal", { filename, length: bytes.length });
  let target: URL;
  try {
    target = new URL(upload_url ?? "");
  } catch {
    throw new SlackError("unavailable");
  }
  // The upload URL is pre-signed; send bytes only to Slack's file host.
  if (target.protocol !== "https:" || target.hostname !== "files.slack.com")
    throw new SlackError("unavailable");
  if (!file_id) throw new SlackError("unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(target, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) throw new SlackError("unavailable");
  } catch (error) {
    if (error instanceof SlackError) throw error;
    throw new SlackError("unavailable");
  } finally {
    clearTimeout(timer);
  }
  await slackCall("files.completeUploadExternal", {
    files: [{ id: file_id, title }],
  });
  return file_id;
}
