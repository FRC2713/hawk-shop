import type { APIRoute } from "astro";
import { isSlackSignature } from "~/server/slack-interactions";

/**
 * Slack sends a `block_actions` request whenever someone clicks a button,
 * including the release message's link buttons, which have already opened
 * their URL. Hawk Shop has no button that does anything, so this verifies the
 * signature and acknowledges. It reads no shop data and changes nothing.
 *
 * Reachable without Hawk Suite identity (see `src/middleware.ts`). Disabled
 * (no signing secret) answers 404; a bad signature answers 401.
 */
const empty = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

// Slack payloads are small; refuse anything that isn't.
const MAX_BODY_BYTES = 64 * 1024;

export const POST: APIRoute = async ({ request }) => {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return empty(404);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return empty(413);
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return empty(413);
  const valid = isSlackSignature(
    secret,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature"),
    body
  );
  return empty(valid ? 200 : 401);
};
